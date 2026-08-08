import { activityCopy } from "./activity-copy-catalog.js";
import { ACTIVITY_SCHEMA_VERSION, resolveActivityTaxonomy } from "./activity-taxonomy.js";

function subjectFor(family, input, fallback) {
  if (family === "command") return input.command ?? fallback;
  if (family === "file" || family === "exploration") return input.file_path ?? input.path ?? input.pattern ?? input.query ?? fallback;
  if (family === "browser") return input.url ?? input.sessionId ?? fallback;
  if (family === "computer") return input.title ?? input.sessionId ?? fallback;
  if (family === "mcp") return input.tool ?? fallback;
  if (family === "subagent") return input.description ?? input.task ?? fallback;
  return input.query ?? input.name ?? fallback;
}

export function presentActivityOperation({
  id,
  runId,
  tool,
  input = {},
  status,
  startedAt,
  endedAt = null,
  durationMs = null,
  durationSource = "observed",
  files = [],
  sourceEventIds = [],
  sourcePresentation = null,
  descriptor = null,
  locale = "zh-CN"
}) {
  let taxonomy = resolveActivityTaxonomy(tool, descriptor);
  if (files.length) {
    const fileActions = new Set(files.map((file) => file.changeKind));
    const fileTool = fileActions.size !== 1 ? "WorkspaceMutation"
      : fileActions.has("create") ? "Write"
        : fileActions.has("delete") ? "Delete" : "Edit";
    taxonomy = resolveActivityTaxonomy(fileTool);
  }
  const subject = subjectFor(taxonomy.family, input, sourcePresentation?.detail ?? tool);
  const accessories = [];
  for (const file of files) accessories.push({ kind: "file_change", ...file });
  if (taxonomy.family === "command") {
    accessories.push({ kind: "command", value: input.command ?? "" }, { kind: "cwd", value: input.cwd ?? "." });
  }
  if (Number.isFinite(durationMs)) accessories.push({ kind: "duration", value: durationMs });
  return {
    version: ACTIVITY_SCHEMA_VERSION,
    id,
    runId,
    tool,
    semanticKey: taxonomy.semanticKey,
    family: taxonomy.family,
    action: taxonomy.action,
    status,
    startedAt,
    endedAt,
    durationMs,
    durationSource,
    subject: { primary: subject, secondary: taxonomy.family === "command" ? input.cwd ?? "." : null },
    accessories,
    evidence: { sourceEventIds, sourceToolCallIds: [id].filter(Boolean) },
    sourceEventIds,
    presentation: {
      title: activityCopy(taxonomy.semanticKey, status, locale),
      detail: subject,
      locale,
      catalogVersion: 1
    },
    coverage: taxonomy.coverage,
    diagnostic: taxonomy.diagnostic ?? null,
    files,
    command: taxonomy.family === "command" ? { text: input.command ?? "", cwd: input.cwd ?? ".", exitCode: null } : null
  };
}
