import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { localStateDirectory, modelStateDirectory } from "./state-root.mjs";

const stateDirectory = localStateDirectory();
const modelDirectory = modelStateDirectory();
const mcpSecretPath = join(stateDirectory, "mcp-auth.dpapi");
const configPath = join(modelDirectory, "runtime-config.json");
let mcpVaultWrite = Promise.resolve();

function runPowerShell(script, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || "Windows secret storage operation failed"));
    });
    child.stdin.end(input, "utf8");
  });
}

export async function loadPersistedRuntimeConfig() {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    // First run or an empty local state.
    return {};
  }
}

export async function persistRuntimeConfig(config) {
  await mkdir(modelDirectory, { recursive: true });
  await writeFile(configPath, `${JSON.stringify({
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    thinkingEnabled: config.thinkingEnabled,
    reasoningEffort: config.reasoningEffort,
    budgets: config.budgets
  }, null, 2)}\n`, "utf8");
}

export async function protectLocalSecret(value) {
  if (process.platform !== "win32") throw new Error("Persistent secret storage is only enabled on Windows");
  return runPowerShell(
    "$plain = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString $plain -AsPlainText -Force; ConvertFrom-SecureString $secure",
    value
  );
}

export async function unprotectLocalSecret(value) {
  if (process.platform !== "win32") throw new Error("Persistent secret storage is only enabled on Windows");
  return runPowerShell(
    "$cipher = ([Console]::In.ReadToEnd()).Trim(); $secure = ConvertTo-SecureString $cipher; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }",
    value
  );
}

export async function loadMcpCredentialVault() {
  try {
    const encrypted = await readFile(mcpSecretPath, "utf8");
    const parsed = JSON.parse(await unprotectLocalSecret(encrypted));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error("MCP credential vault is unreadable");
  }
}

async function writeMcpCredentialVault(vault) {
  await mkdir(stateDirectory, { recursive: true });
  const encrypted = await protectLocalSecret(JSON.stringify(vault));
  const temporary = `${mcpSecretPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${encrypted}\n`, "utf8");
  await rename(temporary, mcpSecretPath);
}

export function updateMcpCredentialVault(mutator) {
  const operation = mcpVaultWrite.catch(() => {}).then(async () => {
    const vault = await loadMcpCredentialVault();
    const next = await mutator(structuredClone(vault));
    await writeMcpCredentialVault(next ?? vault);
    return next ?? vault;
  });
  mcpVaultWrite = operation;
  return operation;
}

export async function clearMcpCredentialVault() {
  await mcpVaultWrite.catch(() => {});
  try { await unlink(mcpSecretPath); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
