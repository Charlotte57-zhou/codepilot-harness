import { randomUUID } from "node:crypto";

const terminalExecutionEvents = new Set([
  "execution_completed",
  "execution_failed",
  "execution_cancelled",
  "execution_lost"
]);

function publicResult(result) {
  const execution = result?.metadata?.execution ?? result?.error?.details?.execution ?? {};
  return {
    ok: Boolean(result?.ok),
    errorCode: result?.ok ? undefined : result?.error?.code,
    exitCode: execution.exitCode ?? null,
    durationMs: execution.durationMs,
    cancelled: Boolean(execution.cancelled || result?.error?.code === "TOOL_CANCELLED"),
    truncated: execution.truncated
  };
}

/**
 * Owns live OS execution identities and their cancellation/drain lifecycle.
 * SDK tool protocol remains owned by Claude Agent SDK; this broker only owns
 * CodePilot-native OS execution identities such as Browser/Computer helpers.
 */
export class ExecutionBroker {
  constructor({ appendEvent, now = Date.now, createId = randomUUID } = {}) {
    if (typeof appendEvent !== "function") throw new TypeError("ExecutionBroker requires appendEvent");
    this.appendEvent = appendEvent;
    this.now = now;
    this.createId = createId;
    this.executions = new Map();
    this.draining = false;
  }

  async execute({
    executionId = this.createId(),
    sessionId,
    runId,
    toolCallId,
    kind = "process",
    metadata = {},
    parentSignal,
    execute
  }) {
    if (this.draining) {
      const error = new Error("ExecutionBroker is draining");
      error.code = "EXECUTION_BROKER_DRAINING";
      throw error;
    }
    if (!sessionId || !runId || !toolCallId) throw new TypeError("ExecutionBroker requires sessionId, runId, and toolCallId");
    if (typeof execute !== "function") throw new TypeError("ExecutionBroker requires execute");
    if (this.executions.has(executionId)) throw new Error(`Duplicate execution id ${executionId}`);

    const controller = new AbortController();
    const record = {
      executionId,
      sessionId,
      runId,
      toolCallId,
      kind,
      metadata: structuredClone(metadata),
      status: "requested",
      pid: null,
      startedAt: null,
      completedAt: null,
      controller,
      cancelProcess: null,
      detachParentAbort: null,
      promise: null
    };
    this.executions.set(executionId, record);

    if (parentSignal) {
      const abort = () => controller.abort(parentSignal.reason);
      if (parentSignal.aborted) abort();
      else {
        parentSignal.addEventListener("abort", abort, { once: true });
        record.detachParentAbort = () => parentSignal.removeEventListener("abort", abort);
      }
    }

    await this.appendEvent(sessionId, "execution_requested", {
      executionId, runId, toolCallId, kind, metadata
    });

    const runPromise = (async () => {
      try {
        const result = await execute({
          signal: controller.signal,
          onSpawn: async ({ pid, cancel }) => {
            record.pid = pid ?? null;
            record.cancelProcess = typeof cancel === "function" ? cancel : null;
            record.status = "running";
            record.startedAt = new Date(this.now()).toISOString();
            await this.appendEvent(sessionId, "execution_started", {
              executionId, runId, toolCallId, kind, pid: record.pid
            });
          }
        });
        const outcome = publicResult(result);
        const cancelled = controller.signal.aborted || outcome.cancelled;
        record.status = cancelled ? "cancelled" : outcome.ok ? "completed" : "failed";
        record.completedAt = new Date(this.now()).toISOString();
        await this.appendEvent(sessionId, cancelled ? "execution_cancelled" : outcome.ok ? "execution_completed" : "execution_failed", {
          executionId, runId, toolCallId, kind, ...outcome
        });
        return result;
      } catch (error) {
        record.status = controller.signal.aborted ? "cancelled" : "failed";
        record.completedAt = new Date(this.now()).toISOString();
        await this.appendEvent(sessionId, record.status === "cancelled" ? "execution_cancelled" : "execution_failed", {
          executionId,
          runId,
          toolCallId,
          kind,
          errorCode: error?.code ?? "EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        record.detachParentAbort?.();
        record.cancelProcess = null;
      }
    })();
    record.promise = runPromise;
    return runPromise;
  }

  async cancelExecution(executionId, reason = { reason: "user_stop", code: "USER_STOP" }) {
    const record = this.executions.get(executionId);
    if (!record || ["completed", "failed", "cancelled", "lost"].includes(record.status)) return false;
    if (!record.controller.signal.aborted) record.controller.abort(reason);
    await record.cancelProcess?.();
    return true;
  }

  snapshot(executionId) {
    const record = this.executions.get(executionId);
    if (!record) return undefined;
    return {
      executionId: record.executionId,
      sessionId: record.sessionId,
      runId: record.runId,
      toolCallId: record.toolCallId,
      kind: record.kind,
      status: record.status,
      pid: record.pid,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      metadata: structuredClone(record.metadata)
    };
  }

  snapshots() {
    return [...this.executions.keys()].map((id) => this.snapshot(id));
  }

  async recoverOrphans(sessionIds, loadEvents) {
    const recovered = [];
    for (const sessionId of sessionIds) {
      const events = await loadEvents(sessionId);
      const started = new Map();
      const terminal = new Set();
      for (const event of events) {
        const executionId = event.data?.executionId;
        if (!executionId) continue;
        if (event.type === "execution_started") started.set(executionId, event);
        if (terminalExecutionEvents.has(event.type)) terminal.add(executionId);
      }
      for (const [executionId, event] of started) {
        if (terminal.has(executionId)) continue;
        const data = {
          executionId,
          runId: event.data?.runId,
          toolCallId: event.data?.toolCallId,
          kind: event.data?.kind ?? "process",
          previousPid: event.data?.pid ?? null,
          reason: "server_restart",
          result: "process_handle_lost"
        };
        await this.appendEvent(sessionId, "execution_lost", data);
        recovered.push({ sessionId, executionId });
      }
    }
    return recovered;
  }

  async shutdown({
    reason = { reason: "server_shutdown", code: "SERVER_SHUTDOWN" },
    deadlineMs = 2_000
  } = {}) {
    if (this.draining) return;
    this.draining = true;
    const active = [...this.executions.values()].filter((record) => ["requested", "running"].includes(record.status));
    await Promise.all(active.map((record) => this.cancelExecution(record.executionId, reason)));
    const completion = Promise.allSettled(active.map((record) => record.promise).filter(Boolean));
    const timedOut = await Promise.race([
      completion.then(() => false),
      new Promise((resolve) => setTimeout(() => resolve(true), deadlineMs))
    ]);
    if (!timedOut) return;
    for (const record of active) {
      if (!["requested", "running"].includes(record.status)) continue;
      record.status = "lost";
      record.completedAt = new Date(this.now()).toISOString();
      await this.appendEvent(record.sessionId, "execution_lost", {
        executionId: record.executionId,
        runId: record.runId,
        toolCallId: record.toolCallId,
        kind: record.kind,
        previousPid: record.pid,
        reason: "drain_timeout",
        result: "terminal_outcome_unknown"
      });
    }
  }
}
