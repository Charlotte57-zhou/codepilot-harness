export class InteractionSessionManager {
  constructor({ browserRuntime, computerRuntime } = {}) {
    if (!browserRuntime || !computerRuntime) throw new TypeError("InteractionSessionManager requires browser and computer runtimes");
    this.browser = browserRuntime;
    this.computer = computerRuntime;
    this.directory = new Map();
  }

  async startBrowser(input, options) {
    const session = input.mode === "attached"
      ? await this.browser.attach(input, options)
      : await this.browser.startManaged(input, options);
    this.directory.set(session.sessionId, { kind: "browser", mode: session.mode });
    return session;
  }

  async startComputer(input, options) {
    const session = await this.computer.start(input, options);
    this.directory.set(session.sessionId, { kind: "computer" });
    return session;
  }

  require(sessionId, kind) {
    const entry = this.directory.get(sessionId);
    if (!entry || (kind && entry.kind !== kind)) {
      const error = new Error(`${kind ?? "Interaction"} session was not found`);
      error.code = "INTERACTION_SESSION_NOT_FOUND";
      throw error;
    }
    return entry;
  }

  snapshot() {
    return {
      browserSessions: this.browser.listSessions(),
      computerSessions: this.computer.listSessions()
    };
  }

  restoreBrowserSessions(sessions = []) {
    for (const session of sessions) this.directory.set(session.sessionId, { kind: "browser", mode: session.mode, recovered: true });
  }

  async closeSession(sessionId) {
    const entry = this.require(sessionId);
    this.directory.delete(sessionId);
    if (entry.kind === "browser") return this.browser.closeSession(sessionId);
    return this.computer.closeSession(sessionId);
  }

  async close({ preserveRecovery = false } = {}) {
    const entries = [...this.directory.entries()];
    this.directory.clear();
    await Promise.all(entries.map(([id, entry]) => entry.kind === "browser"
      ? this.browser.closeSession(id, { preserveRecovery }).catch(() => {})
      : this.computer.closeSession(id).catch(() => {})));
  }
}
