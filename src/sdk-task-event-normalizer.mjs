const SDK_TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskList"]);
const taskStatuses = new Set(["pending", "in_progress", "completed"]);

function textResult(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return JSON.stringify(value ?? "");
  return value.map((item) => typeof item === "string" ? item : item?.text ?? JSON.stringify(item)).join("\n");
}

function taskIdFromCreateResult(content) {
  return textResult(content).match(/\bTask\s+#?([a-z0-9_-]+)\s+created\b/i)?.[1] ?? null;
}

function normalizeTask(task, fallbackId) {
  if (!task || typeof task !== "object") return null;
  const id = String(task.id ?? task.taskId ?? fallbackId ?? "").trim();
  const content = String(task.content ?? task.subject ?? task.description ?? "").trim();
  if (!id || !content) return null;
  const status = taskStatuses.has(task.status) ? task.status : "pending";
  return {
    id,
    content,
    activeForm: String(task.activeForm ?? task.active_form ?? content).trim() || content,
    status,
    blockedBy: Array.isArray(task.blockedBy ?? task.blocked_by)
      ? (task.blockedBy ?? task.blocked_by).map(String)
      : []
  };
}

function taskListFromResult(content) {
  const text = textResult(content).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
    if (Array.isArray(tasks)) return tasks.map((task, index) => normalizeTask(task, index + 1)).filter(Boolean);
  } catch {
    // Older SDK builds return a human-readable list. Decode only its stable,
    // bounded "#id [status] subject" shape and leave unknown formats visible
    // through a projection diagnostic.
  }
  return text.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*#?([a-z0-9_-]+)\s+\[(pending|in_progress|completed)\]\s+(.+?)\s*$/i);
    return match ? normalizeTask({ id: match[1], status: match[2], content: match[3] }) : null;
  }).filter(Boolean);
}

/**
 * Converts Claude Agent SDK task-tool results into provider-neutral product
 * facts. The SDK remains the task executor; JSONL owns CodePilot replay.
 */
export function normalizeSdkTaskResult({ call, resultContent, runId, sourceEventIds = [] }) {
  if (!call || !SDK_TASK_TOOLS.has(call.name)) return null;
  const source = {
    version: 1,
    runId,
    source: "claude_sdk_task",
    sourceToolCallId: call.id,
    sourceEventIds
  };

  if (call.name === "TaskCreate") {
    const taskId = taskIdFromCreateResult(resultContent);
    const task = normalizeTask({
      id: taskId,
      subject: call.input?.subject,
      description: call.input?.description,
      activeForm: call.input?.activeForm,
      status: "pending",
      blockedBy: call.input?.blockedBy
    });
    return task ? { ...source, operation: "create", taskId: task.id, patch: task } : {
      ...source,
      operation: "diagnostic",
      diagnostic: { code: "SDK_TASK_CREATE_ID_MISSING", message: "TaskCreate result did not expose a stable task id" }
    };
  }

  if (call.name === "TaskUpdate") {
    const taskId = String(call.input?.taskId ?? "").trim();
    if (!taskId) return {
      ...source,
      operation: "diagnostic",
      diagnostic: { code: "SDK_TASK_UPDATE_ID_MISSING", message: "TaskUpdate did not include taskId" }
    };
    const patch = {};
    if (typeof call.input?.subject === "string") patch.content = call.input.subject.trim();
    if (typeof call.input?.activeForm === "string") patch.activeForm = call.input.activeForm.trim();
    if (taskStatuses.has(call.input?.status)) patch.status = call.input.status;
    if (Array.isArray(call.input?.blockedBy)) patch.blockedBy = call.input.blockedBy.map(String);
    return { ...source, operation: "update", taskId, patch };
  }

  const tasks = taskListFromResult(resultContent);
  return tasks.length
    ? { ...source, operation: "snapshot", tasks }
    : {
        ...source,
        operation: "diagnostic",
        diagnostic: { code: "SDK_TASK_LIST_UNRECOGNIZED", message: "TaskList result format was not recognized" }
      };
}

export function isSdkTaskTool(name) {
  return SDK_TASK_TOOLS.has(name);
}
