import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { spawn } from "node:child_process";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function writeFixture(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
  }
}

export async function snapshotTree(root) {
  const result = {};
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", ".codepilot"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result[relative(root, path).replaceAll("\\", "/")] = sha256(await readFile(path));
    }
  }
  await visit(root);
  return result;
}

export function diffTrees(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((path) => before[path] !== after[path]);
}

export function runProcess(command, args, { cwd, env = process.env, timeoutMs = 480_000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { stderr += error.message; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
}

export async function stopProcess(child, graceMs = 5_000) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("close", resolve));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), graceMs))
  ]);
  if (!graceful && child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

export async function validateCase(caseSpec, workspace, before, responseText) {
  const after = await snapshotTree(workspace);
  const changedFiles = diffTrees(before, after);
  const allowed = new Set(caseSpec.allowedChanges);
  const scopePassed = changedFiles.every((path) => allowed.has(path));
  const mutationPassed = caseSpec.allowedChanges.length ? changedFiles.some((path) => allowed.has(path)) : changedFiles.length === 0;
  const command = await runProcess(caseSpec.command[0], caseSpec.command.slice(1), { cwd: workspace, timeoutMs: 60_000 });
  const responsePassed = (caseSpec.responsePatterns ?? []).every((pattern) => new RegExp(pattern, "i").test(responseText));
  return {
    passed: scopePassed && mutationPassed && command.code === 0 && responsePassed,
    scopePassed,
    mutationPassed,
    testsPassed: command.code === 0,
    responsePassed,
    changedFiles,
    testDurationMs: command.durationMs
  };
}

export function uniqueRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export async function waitForServer(child, port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`CodePilot server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/project`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("CodePilot server startup timed out");
}

export async function allocatePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
