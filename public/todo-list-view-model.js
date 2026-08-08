import { buildRunChangeSet } from "./file-change-view-model.js";

const statuses = new Set(["pending", "in_progress", "completed"]);

function byOrder(left, right) {
  if (Number.isFinite(left.sequence) && Number.isFinite(right.sequence)) return left.sequence - right.sequence;
  return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
}

function normalizeTask(task, fallbackId, sourceEventId) {
  if (!task || typeof task !== "object") return null;
  const id = String(task.id ?? task.taskId ?? fallbackId ?? "").trim();
  const content = String(task.content ?? task.subject ?? task.description ?? "").trim();
  if (!id || !content) return null;
  return {
    id,
    content,
    activeForm: String(task.activeForm ?? task.active_form ?? content).trim() || content,
    status: statuses.has(task.status) ? task.status : "pending",
    blockedBy: Array.isArray(task.blockedBy ?? task.blocked_by)
      ? (task.blockedBy ?? task.blocked_by).map(String)
      : [],
    sourceEventId
  };
}

function normalizedFacts(events) {
  return events
    .filter((event) => event.type === "task_progress_changed")
    .map((event) => ({ ...event.data, event }));
}

/**
 * Replays provider-neutral task progress for one run. JSONL remains the
 * durable source; `task_progress_changed` is the only accepted task contract.
 */
export function buildTodoListViewModel(events, { runId } = {}) {
  if (!runId) return null;
  const scoped = [...events].filter((event) => event.data?.runId === runId).sort(byOrder);
  const facts = normalizedFacts(scoped);
  if (!facts.length) return null;

  const tasks = new Map();
  const diagnostics = [];
  let latestEventId = null;
  for (const fact of facts) {
    latestEventId = fact.event?.id ?? latestEventId;
    if (fact.operation === "diagnostic") {
      diagnostics.push({ ...fact.diagnostic, sourceEventId: fact.event?.id });
      continue;
    }
    if (fact.operation === "replace" || fact.operation === "snapshot") {
      const replacement = new Map();
      for (const [index, task] of (fact.tasks ?? []).entries()) {
        const normalized = normalizeTask(task, `${fact.sourceToolCallId ?? fact.event?.id}:${index}`, fact.event?.id);
        if (normalized) replacement.set(normalized.id, normalized);
      }
      tasks.clear();
      for (const [id, task] of replacement) tasks.set(id, task);
      continue;
    }
    if (fact.operation === "create") {
      const normalized = normalizeTask(fact.patch, fact.taskId, fact.event?.id);
      if (!normalized) {
        diagnostics.push({ code: "TASK_CREATE_INVALID", sourceEventId: fact.event?.id });
        continue;
      }
      tasks.set(normalized.id, normalized);
      continue;
    }
    if (fact.operation === "update") {
      const current = tasks.get(String(fact.taskId));
      if (!current) {
        diagnostics.push({ code: "TASK_UPDATE_UNKNOWN_ID", taskId: String(fact.taskId), sourceEventId: fact.event?.id });
        continue;
      }
      const next = { ...current, ...fact.patch, id: current.id, sourceEventId: fact.event?.id };
      if (!statuses.has(next.status)) {
        diagnostics.push({ code: "TASK_STATUS_INVALID", taskId: current.id, sourceEventId: fact.event?.id });
        continue;
      }
      tasks.set(current.id, next);
    }
  }

  const todos = [...tasks.values()].map((todo, index) => ({
    ...todo,
    displayOrdinal: index + 1
  }));
  if (!todos.length) return null;
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const activeIndexes = todos.flatMap((todo, index) => todo.status === "in_progress" ? [index] : []);
  const changes = buildRunChangeSet(events, runId);
  return {
    runId,
    eventId: latestEventId,
    todos,
    completed,
    total: todos.length,
    activeIndexes,
    primaryActiveIndex: activeIndexes[0] ?? -1,
    activeIndex: activeIndexes[0] ?? -1,
    allCompleted: completed === todos.length,
    diagnostics,
    changes
  };
}
