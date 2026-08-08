export const ACTIVITY_SCHEMA_VERSION = 2;
export const ACTIVITY_TAXONOMY_VERSION = 1;

export const ACTIVITY_STATUSES = Object.freeze([
  "queued",
  "waiting_permission",
  "running",
  "completed",
  "partially_failed",
  "failed",
  "declined",
  "cancelled",
  "not_run"
]);

const entries = {
  Bash: ["command.run", "command", "run"],
  Read: ["exploration.read", "exploration", "read"],
  ListFiles: ["exploration.list", "exploration", "list"],
  Glob: ["exploration.list", "exploration", "list"],
  Search: ["exploration.search", "exploration", "search"],
  Grep: ["exploration.search", "exploration", "search"],
  Write: ["file.create", "file", "create"],
  Edit: ["file.edit", "file", "edit"],
  NotebookEdit: ["file.edit", "file", "edit"],
  Delete: ["file.delete", "file", "delete"],
  CreateDirectory: ["file.create_directory", "file", "create_directory"],
  WorkspaceMutation: ["file.edit", "file", "edit"],
  PreviewArtifact: ["browser.preview", "browser", "preview"],
  BrowserStart: ["browser.start", "browser", "start"],
  BrowserNavigate: ["browser.navigate", "browser", "navigate"],
  BrowserInspect: ["browser.inspect", "browser", "inspect"],
  BrowserScreenshot: ["browser.screenshot", "browser", "screenshot"],
  BrowserClick: ["browser.click", "browser", "click"],
  BrowserType: ["browser.type", "browser", "type"],
  BrowserWait: ["browser.wait", "browser", "wait"],
  BrowserNewPage: ["browser.new_page", "browser", "new_page"],
  ComputerListWindows: ["computer.list_windows", "computer", "list_windows"],
  ComputerStart: ["computer.start", "computer", "start"],
  ComputerInspect: ["computer.inspect", "computer", "inspect"],
  ComputerScreenshot: ["computer.screenshot", "computer", "screenshot"],
  ComputerClick: ["computer.click", "computer", "click"],
  ComputerSetValue: ["computer.type", "computer", "type"],
  ComputerKeypress: ["computer.keypress", "computer", "keypress"],
  InteractionClose: ["computer.close", "computer", "close"],
  Agent: ["subagent.spawn", "subagent", "spawn"],
  Task: ["subagent.spawn", "subagent", "spawn"],
  TaskCreate: ["task.update", "task", "update"],
  TaskUpdate: ["task.update", "task", "update"],
  TaskList: ["task.list", "task", "list"],
  UpdateTodoList: ["task.update", "task", "update"],
  WebSearch: ["web.search", "web", "search"],
  WebFetch: ["web.fetch", "web", "fetch"],
  ImageView: ["image.view", "image", "view"],
  ImageGenerate: ["image.generate", "image", "generate"],
  Skill: ["skill.load", "skill", "load"],
  Hook: ["hook.run", "hook", "run"],
  Plan: ["plan.update", "plan", "update"]
};

export const TOOL_ACTIVITY_TAXONOMY = Object.freeze(Object.fromEntries(
  Object.entries(entries).map(([tool, [semanticKey, family, action]]) => [
    tool,
    Object.freeze({ semanticKey, family, action })
  ])
));

export const BOOKKEEPING_ACTIVITY_KEYS = Object.freeze(new Set(["task.update", "task.list", "plan.update"]));

export function resolveActivityTaxonomy(toolName, descriptor) {
  if (descriptor?.semanticKey && descriptor?.family && descriptor?.action) {
    return { ...descriptor, coverage: "explicit" };
  }
  const mapped = TOOL_ACTIVITY_TAXONOMY[toolName];
  if (mapped) return { ...mapped, coverage: "catalog" };
  if (/^(mcp__|mcp:)/i.test(toolName ?? "")) {
    return { semanticKey: "mcp.call", family: "mcp", action: "call", coverage: "pattern" };
  }
  return {
    semanticKey: "generic.dynamic_tool",
    family: "generic",
    action: "call",
    coverage: "fallback",
    diagnostic: { code: "ACTIVITY_TAXONOMY_MISS", tool: toolName ?? "Tool" }
  };
}
