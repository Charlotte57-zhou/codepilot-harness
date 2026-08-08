import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";

const browserCandidates = [
  process.env.CODEPILOT_BROWSER_EXECUTABLE,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);

function runtimeError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function assertNavigationUrl(value) {
  let url;
  try { url = new URL(value); } catch {
    throw runtimeError("BROWSER_URL_INVALID", "Browser URL is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw runtimeError("BROWSER_URL_BLOCKED", "Browser navigation only accepts HTTP and HTTPS URLs");
  }
  return url.toString();
}

function assertLocalCdpEndpoint(value) {
  let url;
  try { url = new URL(value); } catch {
    throw runtimeError("BROWSER_CDP_INVALID", "Chrome CDP endpoint is invalid");
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw runtimeError("BROWSER_CDP_INVALID", "Chrome CDP endpoint uses an unsupported protocol");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw runtimeError("BROWSER_CDP_REMOTE_BLOCKED", "Chrome attachment is restricted to a local CDP endpoint");
  }
  return url.toString();
}

async function findBrowserExecutable(candidates = browserCandidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw runtimeError("BROWSER_EXECUTABLE_MISSING", "Chrome or Edge executable was not found");
}

function withAbort(signal, operation) {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(runtimeError("AUTOMATION_CANCELLED", "Browser operation was cancelled"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(runtimeError("AUTOMATION_CANCELLED", "Browser operation was cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export class BrowserRuntime {
  constructor({
    artifactStore,
    createId = randomUUID,
    playwright = chromium,
    executableCandidates = browserCandidates,
    onEvent,
    sessionStore
  } = {}) {
    if (!artifactStore) throw new TypeError("BrowserRuntime requires artifactStore");
    this.artifactStore = artifactStore;
    this.createId = createId;
    this.playwright = playwright;
    this.executableCandidates = executableCandidates;
    this.onEvent = onEvent;
    this.sessionStore = sessionStore;
    this.sessions = new Map();
  }

  async startManaged({ initialUrl = "about:blank", headless = false } = {}, { signal } = {}) {
    const executablePath = await findBrowserExecutable(this.executableCandidates);
    const browser = await withAbort(signal, this.playwright.launch({
      executablePath,
      headless,
      args: ["--no-first-run", "--no-default-browser-check"]
    }));
    const context = await browser.newContext({ acceptDownloads: false });
    const session = this.#createSession({ mode: "managed", browser, context, owned: true, endpoint: null });
    try {
      const page = await context.newPage();
      this.#trackPage(session, page);
      if (initialUrl !== "about:blank") await page.goto(assertNavigationUrl(initialUrl), { waitUntil: "domcontentloaded" });
      await this.#emit("automation_browser_started", this.publicSession(session.id));
      return this.publicSession(session.id);
    } catch (error) {
      await browser.close().catch(() => {});
      this.sessions.delete(session.id);
      throw error;
    }
  }

  async attach({ endpoint = "http://127.0.0.1:9222", recoveredSessionId } = {}, { signal } = {}) {
    const safeEndpoint = assertLocalCdpEndpoint(endpoint);
    const browser = await withAbort(signal, this.playwright.connectOverCDP(safeEndpoint));
    const contexts = browser.contexts();
    const context = contexts[0];
    if (!context) throw runtimeError("BROWSER_CDP_EMPTY", "Attached Chrome has no browser context");
    const session = this.#createSession({ mode: "attached", browser, context, owned: false, endpoint: safeEndpoint, id: recoveredSessionId });
    for (const page of context.pages()) this.#trackPage(session, page);
    await this.#emit("automation_browser_attached", this.publicSession(session.id));
    await this.sessionStore?.upsert({ sessionId: session.id, mode: "attached", endpoint: safeEndpoint, recoverable: true, updatedAt: new Date().toISOString() });
    return this.publicSession(session.id);
  }

  async recoverPersistedSessions() {
    const descriptors = await this.sessionStore?.list?.() ?? [];
    const recovered = [];
    const lost = [];
    for (const descriptor of descriptors) {
      if (descriptor.mode !== "attached" || !descriptor.endpoint) {
        lost.push({ ...descriptor, reason: "managed_session_not_recoverable" });
        continue;
      }
      try {
        recovered.push(await this.attach({ endpoint: descriptor.endpoint, recoveredSessionId: descriptor.sessionId }));
      } catch (error) {
        lost.push({ ...descriptor, reason: error.code ?? "browser_reconnect_failed" });
      }
    }
    if (this.sessionStore) await this.sessionStore.replace([
      ...recovered.map((session) => ({ sessionId: session.sessionId, mode: "attached", endpoint: this.sessions.get(session.sessionId)?.endpoint, recoverable: true, updatedAt: new Date().toISOString() }))
    ]);
    return { recovered, lost };
  }

  publicSession(sessionId) {
    const session = this.#requireSession(sessionId);
    return {
      sessionId: session.id,
      mode: session.mode,
      createdAt: session.createdAt,
      pageCount: session.pages.size,
      pages: [...session.pages.entries()].map(([pageId, page]) => ({
        pageId,
        url: page.url(),
        closed: page.isClosed()
      }))
    };
  }

  listSessions() {
    return [...this.sessions.keys()].map((id) => this.publicSession(id));
  }

  async inspect({ sessionId, pageId, maxChars = 16_000 } = {}, { signal } = {}) {
    return this.#serialized(sessionId, async (session) => {
      const { page, id } = this.#resolvePage(session, pageId);
      const [title, snapshot] = await withAbort(signal, Promise.all([
        page.title(),
        page.locator("body").ariaSnapshot({ timeout: 8_000 }).catch(async () =>
          page.locator("body").innerText({ timeout: 8_000 })
        )
      ]));
      const content = String(snapshot ?? "");
      const diagnostics = this.#diagnostics(session, id);
      return {
        sessionId,
        pageId: id,
        title,
        url: page.url(),
        externalContent: content.slice(0, maxChars),
        truncated: content.length > maxChars,
        healthy: diagnostics.pageErrors.length === 0 && diagnostics.consoleErrors.length === 0 && diagnostics.httpErrors.length === 0,
        diagnostics
      };
    });
  }

  async navigate({ sessionId, pageId, url } = {}, { signal } = {}) {
    return this.#serialized(sessionId, async (session) => {
      const { page, id } = this.#resolvePage(session, pageId);
      this.#resetDiagnostics(session, id);
      const response = await withAbort(signal, page.goto(assertNavigationUrl(url), {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      }));
      const result = { sessionId, pageId: id, url: page.url(), status: response?.status() ?? null, title: await page.title() };
      await this.#emit("automation_browser_navigated", result);
      return result;
    });
  }

  async click({ sessionId, pageId, locator } = {}, { signal } = {}) {
    return this.#serialized(sessionId, async (session) => {
      const { page, id } = this.#resolvePage(session, pageId);
      const target = this.#locator(page, locator);
      await withAbort(signal, target.click({ timeout: 15_000 }));
      const result = { sessionId, pageId: id, locator: this.#publicLocator(locator), url: page.url() };
      await this.#emit("automation_browser_clicked", result);
      return result;
    });
  }

  async type({ sessionId, pageId, locator, text, submit = false } = {}, { signal } = {}) {
    return this.#serialized(sessionId, async (session) => {
      const { page, id } = this.#resolvePage(session, pageId);
      const target = this.#locator(page, locator);
      await withAbort(signal, target.fill(String(text), { timeout: 15_000 }));
      if (submit) await withAbort(signal, target.press("Enter"));
      const result = { sessionId, pageId: id, locator: this.#publicLocator(locator), charsEntered: String(text).length, submitted: Boolean(submit) };
      await this.#emit("automation_browser_typed", result);
      return result;
    });
  }

  async wait({ sessionId, pageId, locator, state = "visible", timeoutMs = 10_000 } = {}, { signal } = {}) {
    return this.#serialized(sessionId, async (session) => {
      const { page, id } = this.#resolvePage(session, pageId);
      await withAbort(signal, this.#locator(page, locator).waitFor({ state, timeout: timeoutMs }));
      return { sessionId, pageId: id, locator: this.#publicLocator(locator), state };
    });
  }

  async screenshot({ sessionId, pageId, fullPage = false } = {}, { signal } = {}) {
    return this.#serialized(sessionId, async (session) => {
      const { page, id } = this.#resolvePage(session, pageId);
      const buffer = await withAbort(signal, page.screenshot({ type: "png", fullPage }));
      const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const artifact = await this.artifactStore.saveImage(buffer, {
        kind: "browser_screenshot",
        sessionId,
        width: viewport.width,
        height: viewport.height
      });
      await this.#emit("automation_artifact_created", artifact);
      const diagnostics = this.#diagnostics(session, id);
      return {
        sessionId,
        pageId: id,
        url: page.url(),
        artifact,
        healthy: diagnostics.pageErrors.length === 0 && diagnostics.consoleErrors.length === 0 && diagnostics.httpErrors.length === 0,
        diagnostics
      };
    });
  }

  async newPage({ sessionId, url = "about:blank" } = {}, { signal } = {}) {
    return this.#serialized(sessionId, async (session) => {
      const page = await withAbort(signal, session.context.newPage());
      const pageId = this.#trackPage(session, page);
      if (url !== "about:blank") await page.goto(assertNavigationUrl(url), { waitUntil: "domcontentloaded" });
      return { sessionId, pageId, url: page.url() };
    });
  }

  async closeSession(sessionId, { preserveRecovery = false } = {}) {
    const session = this.#requireSession(sessionId);
    this.sessions.delete(sessionId);
    if (!(preserveRecovery && session.mode === "attached")) await session.browser.close().catch(() => {});
    if (!preserveRecovery) await this.sessionStore?.remove(sessionId);
    await this.#emit("automation_browser_closed", { sessionId, mode: session.mode });
  }

  async close({ preserveRecovery = false } = {}) {
    await Promise.all([...this.sessions.keys()].map((id) => this.closeSession(id, { preserveRecovery }).catch(() => {})));
  }

  #createSession({ mode, browser, context, owned, endpoint, id }) {
    const session = {
      id: id ?? this.createId(),
      mode,
      browser,
      context,
      owned,
      endpoint,
      pages: new Map(),
      pageIds: new WeakMap(),
      diagnostics: new Map(),
      queue: Promise.resolve(),
      createdAt: new Date().toISOString()
    };
    this.sessions.set(session.id, session);
    context.on("page", (page) => this.#trackPage(session, page));
    return session;
  }

  #trackPage(session, page) {
    const existing = session.pageIds.get(page);
    if (existing) return existing;
    const pageId = this.createId();
    session.pageIds.set(page, pageId);
    session.pages.set(pageId, page);
    session.diagnostics.set(pageId, { pageErrors: [], consoleErrors: [], httpErrors: [], failedRequests: [] });
    page.on("pageerror", (error) => this.#recordDiagnostic(session, pageId, "pageErrors", error?.message ?? error));
    page.on("console", (message) => {
      const text = message?.text?.() ?? "";
      // Chromium also mirrors HTTP failures as an un-attributed console line.
      // The response listener below records the actionable URL and status.
      if (message?.type?.() === "error" && !/^Failed to load resource:/i.test(text)) {
        this.#recordDiagnostic(session, pageId, "consoleErrors", text);
      }
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const url = response.url();
      if (/\/favicon\.ico(?:\?|$)/i.test(url)) return;
      this.#recordDiagnostic(session, pageId, "httpErrors", `${response.status()} ${response.request().resourceType()} ${url}`);
    });
    page.on("requestfailed", (request) => this.#recordDiagnostic(
      session,
      pageId,
      "failedRequests",
      `${request.method()} ${request.url()} · ${request.failure()?.errorText ?? "failed"}`
    ));
    page.on("close", () => {
      session.pages.delete(pageId);
      session.diagnostics.delete(pageId);
    });
    return pageId;
  }

  #recordDiagnostic(session, pageId, kind, value) {
    const diagnostics = session.diagnostics.get(pageId);
    if (!diagnostics) return;
    const text = String(value ?? "unknown browser error").slice(0, 500);
    diagnostics[kind].push(text);
    if (diagnostics[kind].length > 20) diagnostics[kind].shift();
  }

  #resetDiagnostics(session, pageId) {
    session.diagnostics.set(pageId, { pageErrors: [], consoleErrors: [], httpErrors: [], failedRequests: [] });
  }

  #diagnostics(session, pageId) {
    const value = session.diagnostics.get(pageId) ?? { pageErrors: [], consoleErrors: [], httpErrors: [], failedRequests: [] };
    return {
      pageErrors: [...value.pageErrors],
      consoleErrors: [...value.consoleErrors],
      httpErrors: [...value.httpErrors],
      failedRequests: [...value.failedRequests]
    };
  }

  #requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw runtimeError("BROWSER_SESSION_NOT_FOUND", "Browser session was not found");
    return session;
  }

  #resolvePage(session, pageId) {
    if (pageId) {
      const page = session.pages.get(pageId);
      if (!page || page.isClosed()) throw runtimeError("BROWSER_PAGE_NOT_FOUND", "Browser page was not found");
      return { page, id: pageId };
    }
    const entry = [...session.pages.entries()].find(([, page]) => !page.isClosed());
    if (!entry) throw runtimeError("BROWSER_PAGE_NOT_FOUND", "Browser session has no open page");
    return { id: entry[0], page: entry[1] };
  }

  #locator(page, locator = {}) {
    if (locator.role) return page.getByRole(locator.role, { name: locator.name, exact: locator.exact ?? false });
    if (locator.label) return page.getByLabel(locator.label, { exact: locator.exact ?? false });
    if (locator.text) return page.getByText(locator.text, { exact: locator.exact ?? false });
    if (locator.css) return page.locator(locator.css);
    throw runtimeError("BROWSER_LOCATOR_INVALID", "Browser locator requires role, label, text, or css");
  }

  #publicLocator(locator = {}) {
    return {
      kind: locator.role ? "role" : locator.label ? "label" : locator.text ? "text" : "css",
      role: locator.role,
      name: locator.name,
      label: locator.label,
      text: locator.text,
      css: locator.css,
      exact: Boolean(locator.exact)
    };
  }

  #serialized(sessionId, operation) {
    const session = this.#requireSession(sessionId);
    const run = session.queue.catch(() => {}).then(() => operation(session));
    session.queue = run.catch(() => {});
    return run;
  }

  async #emit(type, data) {
    await this.onEvent?.(type, structuredClone(data));
  }
}

export { assertLocalCdpEndpoint, assertNavigationUrl, findBrowserExecutable };
