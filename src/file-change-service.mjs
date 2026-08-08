import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveWorkspaceWritePath } from "./tools/workspace-path.mjs";

export function hashFileContent(content) {
  return createHash("sha256").update(String(content ?? ""), "utf8").digest("hex");
}

function lineCount(content) {
  if (!content) return 0;
  return String(content).split(/\r?\n/).length;
}

export function createFileChange({ path, operation, beforeContent = "", beforeExists = true, afterContent = "", afterExists = true }) {
  return {
    version: 1,
    path,
    operation,
    before: {
      exists: beforeExists,
      content: beforeExists ? beforeContent : "",
      hash: beforeExists ? hashFileContent(beforeContent) : null
    },
    after: {
      exists: afterExists,
      content: afterExists ? afterContent : "",
      hash: afterExists ? hashFileContent(afterContent) : null
    },
    stats: {
      additions: afterExists ? lineCount(afterContent) : 0,
      deletions: beforeExists ? lineCount(beforeContent) : 0
    }
  };
}

export function projectRunFileChanges(events, runId) {
  const records = events
    .filter((event) => event.data?.runId === runId
      && ((event.type === "tool_completed"
        && event.data?.ok
        && (event.data?.metadata?.fileChange || event.data?.metadata?.fileChanges?.length))
        || (event.type === "workspace_mutation_observed" && event.data?.fileChanges?.length)))
    .flatMap((event) => (event.type === "workspace_mutation_observed"
      ? event.data.fileChanges
      : [event.data.metadata.fileChange, ...(event.data.metadata.fileChanges ?? [])])
      .filter(Boolean)
      .map((record) => ({
        ...record,
        toolCallId: event.data.toolCallId,
        sourceToolCallIds: event.data.sourceToolCallIds
      })));
  const byPath = new Map();
  for (const record of records) {
    const current = byPath.get(record.path);
    if (!current) byPath.set(record.path, { path: record.path, before: record.before, after: record.after, records: [record] });
    else {
      current.after = record.after;
      current.records.push(record);
    }
  }
  const reverted = events.some((event) => event.type === "file_changes_reverted" && event.data?.runId === runId);
  return { runId, files: [...byPath.values()], reverted };
}

async function inspectCurrent(pathInfo) {
  try {
    const content = await readFile(pathInfo.absolutePath, "utf8");
    return { exists: true, content, hash: hashFileContent(content) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, content: "", hash: null };
    throw error;
  }
}

export async function revertRunFileChanges({ events, runId, workspaceRoot }) {
  const changeSet = projectRunFileChanges(events, runId);
  if (!changeSet.files.length) {
    const error = new Error("No recorded file changes for this run");
    error.statusCode = 404;
    throw error;
  }
  if (changeSet.reverted) {
    const error = new Error("This change set was already reverted");
    error.statusCode = 409;
    throw error;
  }

  const targets = [];
  for (const file of changeSet.files) {
    const resolved = await resolveWorkspaceWritePath(workspaceRoot, file.path);
    if (!resolved.ok) {
      const error = new Error(resolved.result?.error?.message ?? "File path is outside the workspace");
      error.statusCode = 400;
      throw error;
    }
    const current = await inspectCurrent(resolved);
    if (current.exists !== file.after.exists || current.hash !== file.after.hash) {
      const error = new Error(`File changed after the agent edit: ${file.path}`);
      error.statusCode = 409;
      error.details = { path: file.path, expectedHash: file.after.hash, actualHash: current.hash };
      throw error;
    }
    targets.push({ file, resolved });
  }

  // All files are verified before the first write. This avoids overwriting
  // user edits and keeps conflict handling deterministic.
  for (const { file, resolved } of targets.reverse()) {
    if (!file.before.exists) {
      await unlink(resolved.absolutePath);
      continue;
    }
    await mkdir(dirname(resolved.absolutePath), { recursive: true });
    await writeFile(resolved.absolutePath, file.before.content, "utf8");
  }
  return { runId, files: changeSet.files.map(({ path }) => path) };
}
