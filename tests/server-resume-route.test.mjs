import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function availablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(check, { timeoutMs = 15_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw lastError ?? new Error("Timed out waiting for condition");
}

test("HTTP resume preserves current run identity and frozen preferences", async (t) => {
  const stateRoot = await mkdtemp(join(tmpdir(), "codepilot-resume-state-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-resume-workspace-"));
  const seed = `
    const { createSession, appendEvent } = await import('./src/session-store.mjs');
    const session = await createSession('Resume route', { workspaceTargetId: 'target-0123456789abcdef' });
    await appendEvent(session.id, 'run_preferences_selected', {
      permissionMode: 'full',
      model: { provider: 'anthropic', baseUrl: 'http://127.0.0.1:1', model: 'claude-sonnet-4-6' },
      budgetPolicy: { maxTurns: 12, maxRetries: 1, deadlineMs: 5000, maxOutputTokens: 8000, compactionOutputTokens: 2000 },
      runId: 'run-resume'
    });
    await appendEvent(session.id, 'user_message', { content: 'inspect the current workspace', runId: 'run-resume' });
    process.stdout.write(session.id);
  `;
  const env = {
    ...process.env,
    CODEPILOT_STATE_ROOT: stateRoot,
    CODEPILOT_APPLICATION_MODEL_STATE_ROOT: stateRoot,
    CODEPILOT_WORKSPACE_ROOT: workspaceRoot,
    MODEL_PROVIDER: "anthropic",
    MODEL_BASE_URL: "http://127.0.0.1:1",
    MODEL_NAME: "claude-sonnet-4-6",
    MODEL_API_KEY: "test-resume-route-key",
    CODEPILOT_MAX_RETRIES: "1",
    CODEPILOT_RUN_DEADLINE_MS: "5000"
  };
  const seeded = spawnSync(process.execPath, ["--input-type=module", "--eval", seed], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8"
  });
  assert.equal(seeded.status, 0, seeded.stderr);
  const sessionId = seeded.stdout.trim();
  assert.match(sessionId, /^[a-z0-9-]+$/i);

  const port = await availablePort();
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repositoryRoot,
    env: { ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  });

  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}: ${stderr}`);
    const ready = await fetch(`${origin}/api/project`);
    if (!ready.ok) throw new Error(`Server readiness returned ${ready.status}: ${await ready.text()} ${stderr}`);
    return true;
  });
  const response = await fetch(`${origin}/api/sessions/${sessionId}/resume`, { method: "POST" });
  assert.equal(response.status, 202, stderr);
  assert.deepEqual(await response.json(), { accepted: true, resumed: true, runId: "run-resume" });

  let observedEvents = [];
  let events;
  try {
    events = await waitFor(async () => {
      const result = await fetch(`${origin}/api/sessions/${sessionId}/events`);
      observedEvents = await result.json();
      return observedEvents.some((event) => event.type === "runtime_options_frozen") ? observedEvents : null;
    });
  } catch (error) {
    throw new Error(`${error.message}; events=${JSON.stringify(observedEvents.slice(-4).map((event) => ({ type: event.type, data: event.data })))}; stderr=${stderr}`);
  }
  const resumed = events.find((event) => event.type === "session_resumed");
  const frozen = events.find((event) => event.type === "runtime_options_frozen");
  assert.equal(resumed.data.runId, "run-resume");
  assert.equal(frozen.data.runId, "run-resume");
  assert.equal(frozen.data.permissionMode, "full");
});
