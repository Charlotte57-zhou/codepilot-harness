import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { controlledCases } from "./cases.mjs";
import { allocatePort, runProcess, sha256, snapshotTree, stopProcess, uniqueRunId, validateCase, waitForServer, writeFixture } from "./lib.mjs";
import { summarizeResults, writeComparisonReport } from "./report.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));
const freeze = JSON.parse(await readFile(join(repoRoot, "evaluation", "freeze-manifest.json"), "utf8"));
for (const [path, expected] of Object.entries(freeze.architectureHashes)) {
  const actual = sha256(await readFile(join(repoRoot, path)));
  if (actual !== expected) throw new Error(`Architecture freeze mismatch: ${path}`);
}
if (freeze.model !== "deepseek-v4-flash" || freeze.caseCount !== controlledCases.length) throw new Error("Controlled evaluation freeze metadata mismatch");
const runId = uniqueRunId();
const runRoot = join(repoRoot, "evaluation", "workspaces", runId);
const artifactRoot = join(repoRoot, "evaluation", "artifacts", "raw", runId);
const resultsRoot = join(repoRoot, "evaluation", "results");
await mkdir(runRoot, { recursive: true });
await mkdir(artifactRoot, { recursive: true });
await mkdir(resultsRoot, { recursive: true });

function responseTextFromEvents(events) {
  const final = [...events].reverse().find((event) => event.type === "agent_final");
  return String(final?.data?.summary ?? final?.data?.text ?? final?.data?.content ?? final?.data?.message ?? "");
}

async function runCodePilot(caseSpec, workspace, stateRoot) {
  const port = await allocatePort();
  const previewPort = await allocatePort();
  const env = {
    ...process.env,
    PORT: String(port),
    CODEPILOT_PREVIEW_PORT: String(previewPort),
    CODEPILOT_DESKTOP: "1",
    CODEPILOT_PROJECT_ID: `eval-${caseSpec.id}`,
    CODEPILOT_PROJECT_NAME: `eval-${caseSpec.id}`,
    CODEPILOT_WORKSPACE_ROOT: workspace,
    CODEPILOT_STATE_ROOT: stateRoot,
    CODEPILOT_MAX_TURNS: "24",
    CODEPILOT_RUN_DEADLINE_MS: "480000"
  };
  const child = spawn(process.execPath, [join(repoRoot, "server.mjs")], { cwd: repoRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const startedAt = Date.now();
  try {
    await waitForServer(child, port);
    const config = await fetch(`http://127.0.0.1:${port}/api/config`).then((response) => response.json());
    if (config.provider !== "deepseek" || config.model !== "deepseek-v4-flash") throw new Error("CodePilot model freeze mismatch");
    const session = await fetch(`http://127.0.0.1:${port}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `eval-${caseSpec.id}` }) }).then((response) => response.json());
    const runResponse = await fetch(`http://127.0.0.1:${port}/api/sessions/${session.id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: caseSpec.prompt, permissionMode: "full" }) });
    if (!runResponse.ok) throw new Error(`CodePilot run rejected: ${runResponse.status}`);
    const deadline = Date.now() + 500_000;
    let events = [];
    while (Date.now() < deadline) {
      events = await fetch(`http://127.0.0.1:${port}/api/sessions/${session.id}/events`).then((response) => response.json());
      if (events.some((event) => event.type === "agent_final" || event.type === "agent_error" || (event.type === "run_state_changed" && ["failed", "cancelled"].includes(event.data?.to)))) break;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    const terminal = [...events].reverse().find((event) => event.type === "agent_final" || event.type === "agent_error" || event.type === "run_state_changed");
    return {
      responseText: responseTextFromEvents(events),
      durationMs: Date.now() - startedAt,
      model: config.model,
      provider: config.provider,
      terminal: terminal?.type === "agent_final" ? "completed" : terminal?.data?.to ?? terminal?.type ?? "timeout",
      eventCount: events.length,
      stderrCategory: stderr ? "present" : "empty"
    };
  } finally {
    await stopProcess(child);
  }
}

async function runClaudeCli(caseSpec, workspace) {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!authToken) throw new Error("ANTHROPIC_AUTH_TOKEN is required for the isolated Claude CLI adapter");
  const env = {
    ...process.env,
    ANTHROPIC_API_KEY: authToken,
    ANTHROPIC_MODEL: "deepseek-v4-flash",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-flash",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-flash",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1"
  };
  const claudeCommand = process.platform === "win32"
    ? join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
    : "claude";
  const result = await runProcess(claudeCommand, [
    caseSpec.prompt,
    "--bare", "--print", "--no-session-persistence", "--output-format", "json",
    "--model", "deepseek-v4-flash", "--effort", "high",
    "--allow-dangerously-skip-permissions", "--permission-mode", "bypassPermissions",
    "--allowedTools", "Read,Glob,Grep,Edit,Write,Bash"
  ], { cwd: workspace, env, timeoutMs: 500_000 });
  let payload = {};
  try { payload = JSON.parse(result.stdout); } catch {}
  return {
    responseText: String(payload.result ?? payload.message ?? result.stdout),
    durationMs: result.durationMs,
    model: "deepseek-v4-flash",
    provider: "deepseek-via-claude-cli",
    terminal: result.code === 0 ? "completed" : "failed",
    eventCount: null,
    stderrCategory: result.stderr ? "present" : "empty"
  };
}

const requestedCaseIds = new Set(String(process.env.EVAL_CASE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const selectedCases = requestedCaseIds.size ? controlledCases.filter((item) => requestedCaseIds.has(item.id)) : controlledCases;
if (!selectedCases.length) throw new Error("No controlled evaluation cases selected");
const allAdapters = [["codepilot", runCodePilot], ["claude-cli", runClaudeCli]];
const requestedAdapters = new Set(String(process.env.EVAL_ADAPTERS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const adapters = requestedAdapters.size ? allAdapters.filter(([name]) => requestedAdapters.has(name)) : allAdapters;
if (!adapters.length) throw new Error("No controlled evaluation adapters selected");
const results = [];
for (const caseSpec of selectedCases) {
  for (const [adapterName, adapter] of adapters) {
    const workspace = join(runRoot, `${caseSpec.id}-${adapterName}`, "workspace");
    const stateRoot = join(runRoot, `${caseSpec.id}-${adapterName}`, "state");
    await mkdir(workspace, { recursive: true });
    await mkdir(stateRoot, { recursive: true });
    await writeFixture(workspace, caseSpec.files);
    const before = await snapshotTree(workspace);
    let adapterResult;
    let infrastructureError = null;
    try {
      adapterResult = await adapter(caseSpec, workspace, stateRoot);
    } catch (error) {
      infrastructureError = error instanceof Error ? error.message : String(error);
      adapterResult = { responseText: "", durationMs: 0, model: "deepseek-v4-flash", provider: adapterName, terminal: "infrastructure_error", eventCount: null, stderrCategory: "present" };
    }
    const validation = await validateCase(caseSpec, workspace, before, adapterResult.responseText);
    const record = {
      runId,
      caseId: caseSpec.id,
      category: caseSpec.category,
      adapter: adapterName,
      model: adapterResult.model,
      provider: adapterResult.provider,
      terminal: adapterResult.terminal,
      durationMs: adapterResult.durationMs,
      eventCount: adapterResult.eventCount,
      stderrCategory: adapterResult.stderrCategory,
      infrastructureError,
      validation
    };
    await writeFile(join(artifactRoot, `${caseSpec.id}-${adapterName}.json`), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    results.push(record);
    console.log(`${adapterName.padEnd(10)} ${caseSpec.id.padEnd(24)} ${validation.passed ? "PASS" : "FAIL"} ${adapterResult.durationMs}ms`);
  }
}

const byAdapter = summarizeResults(results, adapters.map(([name]) => name));
const summary = { schemaVersion: 1, runId, architectureFreeze: freeze.productCommit, model: freeze.model, isolation: { freshWorkspacePerRun: true, freshCodePilotSessionPerRun: true, claudeNoSessionPersistence: true, rawArtifactsCommitted: false }, byAdapter, results };
await writeComparisonReport({ resultsRoot, summary, cases: selectedCases });
console.log(JSON.stringify(byAdapter, null, 2));
