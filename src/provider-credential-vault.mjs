import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeAnthropicProviderId } from "./anthropic-provider-profile.mjs";
import { protectLocalSecret, unprotectLocalSecret } from "./secret-store.mjs";
import { modelStateDirectory } from "./state-root.mjs";

const vaultVersion = 1;

function normalizeVault(value) {
  const credentials = value?.version === vaultVersion && value.credentials && typeof value.credentials === "object"
    ? value.credentials
    : {};
  return {
    version: vaultVersion,
    credentials: Object.fromEntries(Object.entries(credentials)
      .map(([provider, credential]) => [normalizeAnthropicProviderId(provider), String(credential ?? "")])
      .filter(([, credential]) => credential.length > 0))
  };
}

export class ProviderCredentialVault {
  constructor({ vaultPath, protect = protectLocalSecret, unprotect = unprotectLocalSecret } = {}) {
    if (!vaultPath) throw new TypeError("vaultPath is required");
    this.vaultPath = vaultPath;
    this.protect = protect;
    this.unprotect = unprotect;
    this.state = normalizeVault();
    this.initialized = false;
    this.writeQueue = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return this.status();
    try {
      const encrypted = await readFile(this.vaultPath, "utf8");
      this.state = normalizeVault(JSON.parse(await this.unprotect(encrypted)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("Provider credential vault is unreadable");
    }
    this.initialized = true;
    return this.status();
  }

  async reload() {
    await this.writeQueue.catch(() => {});
    try {
      const encrypted = await readFile(this.vaultPath, "utf8");
      this.state = normalizeVault(JSON.parse(await this.unprotect(encrypted)));
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error("Provider credential vault is unreadable");
      this.state = normalizeVault();
    }
    this.initialized = true;
    return this.status();
  }

  get(provider) {
    this.#assertInitialized();
    return this.state.credentials[normalizeAnthropicProviderId(provider)] ?? "";
  }

  status() {
    return Object.freeze(Object.keys(this.state.credentials).sort());
  }

  set(provider, credential) {
    const id = normalizeAnthropicProviderId(provider);
    const value = String(credential ?? "");
    if (!value) return this.clear(id);
    return this.#mutate((next) => { next.credentials[id] = value; });
  }

  clear(provider) {
    const id = normalizeAnthropicProviderId(provider);
    return this.#mutate((next) => { delete next.credentials[id]; });
  }

  clearAll() {
    return this.#mutate((next) => { next.credentials = {}; });
  }

  #assertInitialized() {
    if (!this.initialized) throw new Error("Provider credential vault is not initialized");
  }

  #mutate(mutator) {
    this.#assertInitialized();
    const operation = this.writeQueue.catch(() => {}).then(async () => {
      const next = structuredClone(this.state);
      mutator(next);
      await this.#write(next);
      this.state = normalizeVault(next);
      return this.status();
    });
    this.writeQueue = operation;
    return operation;
  }

  async #write(value) {
    await mkdir(dirname(this.vaultPath), { recursive: true });
    const encrypted = await this.protect(JSON.stringify(normalizeVault(value)));
    const temporary = `${this.vaultPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${encrypted}\n`, "utf8");
    await rename(temporary, this.vaultPath);
  }
}

const stateDirectory = modelStateDirectory();
const providerCredentialVault = new ProviderCredentialVault({
  vaultPath: join(stateDirectory, "model-credentials.dpapi")
});

export function initializeProviderCredentialVault(options) {
  return providerCredentialVault.initialize(options);
}

export function reloadProviderCredentialVault() {
  return providerCredentialVault.reload();
}

export function getProviderCredential(provider) {
  return providerCredentialVault.get(provider);
}

export function getConfiguredProviderIds() {
  return providerCredentialVault.status();
}

export function persistProviderCredential(provider, credential) {
  return providerCredentialVault.set(provider, credential);
}

export function clearProviderCredential(provider) {
  return providerCredentialVault.clear(provider);
}

export function clearAllProviderCredentials() {
  return providerCredentialVault.clearAll();
}
