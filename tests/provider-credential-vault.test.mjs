import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ProviderCredentialVault } from "../src/provider-credential-vault.mjs";

const protect = async (value) => Buffer.from(value, "utf8").toString("base64");
const unprotect = async (value) => Buffer.from(String(value).trim(), "base64").toString("utf8");

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), "codepilot-credential-test-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("provider credential vault serializes concurrent provider writes without cross-provider loss", async () => {
  await withTemporaryDirectory(async (directory) => {
    const options = {
      vaultPath: join(directory, "model-credentials.dpapi"),
      protect,
      unprotect
    };
    const vault = new ProviderCredentialVault(options);
    await vault.initialize();
    await Promise.all([
      vault.set("anthropic", "anthropic-secret"),
      vault.set("deepseek", "deepseek-secret")
    ]);

    const restored = new ProviderCredentialVault(options);
    await restored.initialize();
    assert.equal(restored.get("anthropic"), "anthropic-secret");
    assert.equal(restored.get("deepseek"), "deepseek-secret");
    assert.deepEqual(restored.status(), ["anthropic", "deepseek"]);
  });
});

test("a warm runtime credential vault reloads changes written by the active runtime", async () => {
  await withTemporaryDirectory(async (directory) => {
    const options = {
      vaultPath: join(directory, "model-credentials.dpapi"),
      protect,
      unprotect
    };
    const active = new ProviderCredentialVault(options);
    const warm = new ProviderCredentialVault(options);
    await active.initialize();
    await warm.initialize();

    await active.set("deepseek", "deepseek-secret");
    assert.equal(warm.get("deepseek"), "");
    assert.deepEqual(await warm.reload(), ["deepseek"]);
    assert.equal(warm.get("deepseek"), "deepseek-secret");
  });
});

test("local Windows DPAPI switching restores only the selected provider credential", {
  skip: process.platform !== "win32"
    ? "Windows DPAPI only"
    : process.env.GITHUB_ACTIONS === "true"
      ? "GitHub-hosted Windows does not expose a usable user DPAPI module"
      : false
}, async () => {
  await withTemporaryDirectory(async (directory) => {
    const moduleUrl = pathToFileURL(resolve("src/model-runtime-config.mjs")).href;
    const script = `
      const { readFile } = await import("node:fs/promises");
      const config = await import(${JSON.stringify(moduleUrl)});
      const anthropicCredential = ["fixture", "anthropic"].join("-");
      const deepseekCredential = ["fixture", "deepseek"].join("-");
      await config.initializeModelRuntimeConfig();
      await config.updateModelConfig({ provider: "anthropic", apiKey: anthropicCredential });
      const switched = await config.updateModelConfig({ provider: "deepseek" });
      if (switched.hasApiKey || config.getModelEnvironment().MODEL_API_KEY) throw new Error("credential leaked across providers");
      await config.updateModelConfig({ provider: "deepseek", apiKey: deepseekCredential });
      const restored = await config.updateModelConfig({ provider: "anthropic" });
      if (!restored.hasApiKey || config.getModelEnvironment().MODEL_API_KEY !== anthropicCredential) throw new Error("provider credential was not restored");
      if (restored.configuredProviders.join(",") !== "anthropic,deepseek") throw new Error("credential status projection is incomplete");
      await config.updateModelConfig({ clearApiKey: true });
      const deepseek = await config.updateModelConfig({ provider: "deepseek" });
      if (!deepseek.hasApiKey || config.getModelEnvironment().MODEL_API_KEY !== deepseekCredential) throw new Error("clearing one provider removed another provider credential");
      const publicConfig = await readFile(".codepilot/runtime-config.json", "utf8");
      const encryptedVault = await readFile(".codepilot/model-credentials.dpapi", "utf8");
      if (publicConfig.includes("fixture") || encryptedVault.includes(deepseekCredential)) throw new Error("credential reached plaintext persistence");
    `;
    await new Promise((resolveRun, rejectRun) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
        cwd: directory,
        env: {
          ...process.env,
          MODEL_PROVIDER: "",
          MODEL_BASE_URL: "",
          MODEL_NAME: "",
          MODEL_API_KEY: ""
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", rejectRun);
      child.on("close", (code) => code === 0 ? resolveRun() : rejectRun(new Error(stderr || `child exited ${code}`)));
    });
  });
});

test("model settings project per-provider credential status without rendering secrets", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(source, /configuredProviders\?\.includes\(provider\)/);
  assert.match(source, /该 Provider 已配置（留空保持不变）/);
  assert.match(source, /elements\.modelApiKey\.value = "";\s*renderProviderFields\(elements\.modelProvider\.value\)/);
  assert.doesNotMatch(source, /state\.modelConfig\?\.apiKey/);
});
