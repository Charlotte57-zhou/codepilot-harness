import { randomUUID } from "node:crypto";

const terminalEvents = new Set(["supervisor_run_completed", "supervisor_run_failed", "supervisor_run_cancelled", "supervisor_run_orphaned"]);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function cancellationReason(reason = {}) {
  if (reason && typeof reason === "object") return reason;
  return { reason: "user_stop", code: "USER_STOP", message: String(reason || "Run cancelled") };
}

/**
 * Owns run identity, queuing, cancellation and parent/child relationships.
 * Claude Agent SDK owns one run's internal sampling and tool protocol.
 */
export class RunSupervisor {
  constructor({ appendEvent, now = Date.now } = {}) {
    if (typeof appendEvent !== "function") throw new TypeError("RunSupervisor requires appendEvent");
    this.appendEvent = appendEvent;
    this.now = now;
    this.runs = new Map();
    this.activeForegroundBySession = new Map();
    this.foregroundQueues = new Map();
    this.listeners = new Set();
    this.closing = false;
  }

  hasActive(sessionId) {
    return [...this.runs.values()].some((run) => run.sessionId === sessionId && run.status === "running");
  }

  hasAnyActive() {
    return [...this.runs.values()].some((run) => ["queued", "running"].includes(run.status));
  }

  activeRun(sessionId) {
    const id = this.activeForegroundBySession.get(sessionId);
    return id ? this.snapshot(id) : undefined;
  }

  snapshot(runId) {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    return Object.freeze({
      runId: run.runId,
      sessionId: run.sessionId,
      parentRunId: run.parentRunId,
      kind: run.kind,
      status: run.status,
      queuedAt: run.queuedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("RunSupervisor listener must be a function");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async schedule({ sessionId, runId = randomUUID(), parentRunId, kind = "foreground", parentSignal, execute, metadata = {} }) {
    if (this.closing) throw new Error("RunSupervisor is shutting down");
    if (typeof execute !== "function") throw new TypeError("RunSupervisor run requires execute");
    if (!sessionId) throw new TypeError("RunSupervisor run requires sessionId");
    if (!new Set(["foreground", "background", "child"]).has(kind)) throw new TypeError(`Unsupported run kind: ${kind}`);
    if (this.runs.has(runId)) throw new Error(`Run already exists: ${runId}`);

    const completion = deferred();
    // Avoid process-level unhandled rejection noise before a queued caller attaches.
    completion.promise.catch(() => {});
    const run = {
      runId, sessionId, parentRunId, kind, execute, metadata,
      controller: new AbortController(), completion,
      status: "created", queuedAt: new Date(this.now()).toISOString(),
      startedAt: null, completedAt: null, detachParentAbort: null
    };
    if (parentSignal) {
      const abort = () => run.controller.abort(cancellationReason(parentSignal.reason));
      if (parentSignal.aborted) abort();
      else {
        parentSignal.addEventListener("abort", abort, { once: true });
        run.detachParentAbort = () => parentSignal.removeEventListener("abort", abort);
      }
    }
    this.runs.set(runId, run);

    if (kind === "foreground" && this.activeForegroundBySession.has(sessionId)) {
      run.status = "queued";
      const queue = this.foregroundQueues.get(sessionId) ?? [];
      queue.push(runId);
      this.foregroundQueues.set(sessionId, queue);
      await this.#emit(run, "supervisor_run_queued", { queuePosition: queue.length });
    } else {
      await this.#launch(run);
    }
    return { runId, promise: completion.promise, cancel: (reason) => this.cancelRun(runId, reason), snapshot: () => this.snapshot(runId) };
  }

  async cancelRun(runId, reason) {
    const run = this.runs.get(runId);
    if (!run || ["completed", "failed", "cancelled", "orphaned"].includes(run.status)) return false;
    const cancellation = cancellationReason(reason);
    if (run.status === "queued") {
      const queue = this.foregroundQueues.get(run.sessionId) ?? [];
      this.foregroundQueues.set(run.sessionId, queue.filter((candidate) => candidate !== runId));
      run.status = "cancelled";
      run.completedAt = new Date(this.now()).toISOString();
      await this.#emit(run, "supervisor_run_cancelled", { cancellation, executionStarted: false });
      run.completion.resolve({ state: "cancelled", cancellation });
      run.detachParentAbort?.();
      return true;
    }
    run.controller.abort(cancellation);
    await this.#emit(run, "supervisor_cancel_requested", { cancellation, executionStarted: true });
    return true;
  }

  async cancelSession(sessionId, reason) {
    const candidates = [...this.runs.values()].filter((run) => run.sessionId === sessionId && ["queued", "running"].includes(run.status));
    const outcomes = await Promise.all(candidates.map((run) => this.cancelRun(run.runId, reason)));
    return outcomes.some(Boolean);
  }

  async recoverOrphans(sessionIds, getEvents, repair) {
    const orphaned = [];
    for (const sessionId of sessionIds) {
      const events = await getEvents(sessionId);
      const started = new Map();
      const terminal = new Set();
      for (const event of events) {
        const runId = event.data?.runId;
        if (!runId) continue;
        if (event.type === "supervisor_run_started") started.set(runId, event);
        if (terminalEvents.has(event.type)) terminal.add(runId);
      }
      for (const [runId, event] of started) {
        if (terminal.has(runId)) continue;
        const data = { runId, parentRunId: event.data?.parentRunId, kind: event.data?.kind, reason: "process_restart" };
        await this.appendEvent(sessionId, "supervisor_run_orphaned", data);
        await repair?.({ sessionId, runId, event });
        orphaned.push({ sessionId, runId });
      }
    }
    return orphaned;
  }

  async shutdown(reason = { reason: "server_shutdown", code: "SERVER_SHUTDOWN", message: "Server is shutting down" }) {
    this.closing = true;
    const pending = [...this.runs.values()].filter((run) => ["queued", "running"].includes(run.status));
    await Promise.all(pending.map((run) => this.cancelRun(run.runId, reason)));
    await Promise.allSettled(pending.map((run) => run.completion.promise));
  }

  async #launch(run) {
    run.status = "running";
    run.startedAt = new Date(this.now()).toISOString();
    if (run.kind === "foreground") this.activeForegroundBySession.set(run.sessionId, run.runId);
    await this.#emit(run, "supervisor_run_started", { metadata: run.metadata });

    void Promise.resolve()
      .then(() => {
        if (run.controller.signal.aborted) {
          return { state: "cancelled", cancellation: cancellationReason(run.controller.signal.reason) };
        }
        return run.execute({ signal: run.controller.signal, runId: run.runId, parentRunId: run.parentRunId, kind: run.kind });
      })
      .then(async (result) => {
        const cancelled = run.controller.signal.aborted || result?.state === "cancelled";
        run.status = cancelled ? "cancelled" : "completed";
        run.completedAt = new Date(this.now()).toISOString();
        await this.#emit(run, cancelled ? "supervisor_run_cancelled" : "supervisor_run_completed", {
          cancellation: cancelled ? cancellationReason(run.controller.signal.reason ?? result?.cancellation) : undefined
        });
        run.completion.resolve(result);
      })
      .catch(async (error) => {
        run.status = run.controller.signal.aborted ? "cancelled" : "failed";
        run.completedAt = new Date(this.now()).toISOString();
        await this.#emit(run, run.status === "cancelled" ? "supervisor_run_cancelled" : "supervisor_run_failed", {
          message: error instanceof Error ? error.message : String(error),
          cancellation: run.status === "cancelled" ? cancellationReason(run.controller.signal.reason) : undefined
        });
        run.completion.reject(error);
      })
      .finally(async () => {
        run.detachParentAbort?.();
        if (run.kind === "foreground" && this.activeForegroundBySession.get(run.sessionId) === run.runId) {
          this.activeForegroundBySession.delete(run.sessionId);
          await this.#startNextForeground(run.sessionId);
        }
      });
  }

  async #startNextForeground(sessionId) {
    const queue = this.foregroundQueues.get(sessionId) ?? [];
    while (queue.length) {
      const next = this.runs.get(queue.shift());
      if (next?.status !== "queued") continue;
      if (!queue.length) this.foregroundQueues.delete(sessionId);
      else this.foregroundQueues.set(sessionId, queue);
      await this.#launch(next);
      return;
    }
    this.foregroundQueues.delete(sessionId);
  }

  async #emit(run, type, data = {}) {
    const payload = {
      runId: run.runId,
      parentRunId: run.parentRunId,
      kind: run.kind,
      supervisorState: run.status,
      ...data
    };
    await this.appendEvent(run.sessionId, type, payload);
    const snapshot = this.snapshot(run.runId);
    for (const listener of this.listeners) {
      try { listener({ type, run: snapshot, data: payload }); } catch { /* Observers cannot break runtime state. */ }
    }
  }
}
