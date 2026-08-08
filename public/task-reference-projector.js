function taskIdentity(task) {
  return String(task?.id ?? "").trim();
}

/**
 * Projects provider-owned task identities into run-local display ordinals.
 * The source text and JSONL stay untouched; unknown references are preserved.
 */
export function projectTaskProgressReferences(text, todo) {
  const source = String(text ?? "");
  if (!source || !todo?.todos?.length) return source;

  const ordinalById = new Map(todo.todos.map((task, index) => [
    taskIdentity(task),
    Number.isFinite(task.displayOrdinal) ? task.displayOrdinal : index + 1
  ]));
  const total = todo.total ?? todo.todos.length;

  const progress = source.replace(
    /(\bTask\s+|任务\s*)(#?)([a-z0-9_-]+)\s*\/\s*([a-z0-9_-]+)/gi,
    (match, prefix, marker, taskId) => {
      const ordinal = ordinalById.get(String(taskId));
      return ordinal == null ? match : `${prefix}${marker}${ordinal}/${total}`;
    }
  );

  let inTaskTable = false;
  return progress.split(/\r?\n/).map((line) => {
    if (/^\s*\|\s*#\s*\|\s*(?:任务|Task)(?:\s|\|)/i.test(line)) {
      inTaskTable = true;
      return line;
    }
    if (!line.trim().startsWith("|")) {
      inTaskTable = false;
      return line;
    }
    if (!inTaskTable || /^\s*\|\s*:?-{3,}/.test(line)) return line;
    return line.replace(/^(\s*\|\s*)([a-z0-9_-]+)(\s*\|)/i, (match, before, taskId, after) => {
      const ordinal = ordinalById.get(String(taskId));
      return ordinal == null ? match : `${before}${ordinal}${after}`;
    });
  }).join("\n");
}
