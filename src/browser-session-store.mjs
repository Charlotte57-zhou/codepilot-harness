import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class BrowserSessionStore {
  constructor({ workspaceRoot } = {}) {
    if (!workspaceRoot) throw new TypeError("BrowserSessionStore requires workspaceRoot");
    this.path = join(workspaceRoot, ".codepilot", "browser-sessions.json");
  }
  async list() {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8"));
      return Array.isArray(value.sessions) ? value.sessions.filter((item) => item?.sessionId && item?.mode) : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  async replace(sessions) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, sessions }, null, 2), "utf8");
    await rename(temporary, this.path);
  }
  async upsert(descriptor) {
    const sessions = (await this.list()).filter((item) => item.sessionId !== descriptor.sessionId);
    sessions.push(descriptor);
    await this.replace(sessions);
  }
  async remove(sessionId) {
    await this.replace((await this.list()).filter((item) => item.sessionId !== sessionId));
  }
}
