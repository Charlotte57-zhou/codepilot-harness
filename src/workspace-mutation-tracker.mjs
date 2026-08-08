import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createFileChange } from "./file-change-service.mjs";

const ignoredDirectories = new Set([".git", ".codepilot", "node_modules"]);

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function textContent(buffer) {
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

export async function snapshotWorkspace(root, { maxFiles = 5_000, maxFileBytes = 250_000 } = {}) {
  const files = new Map();
  let scanned = 0;
  let truncated = false;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (scanned >= maxFiles) { truncated = true; return; }
      if (entry.isSymbolicLink()) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;
      const buffer = await readFile(absolutePath);
      files.set(relative(root, absolutePath).replaceAll("\\", "/"), {
        hash: hash(buffer),
        bytes: buffer.length,
        content: buffer.length <= maxFileBytes ? textContent(buffer) : null
      });
    }
  }
  await visit(root);
  return { files, scanned, truncated };
}

export function diffWorkspaceSnapshots(before, after) {
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  const fileChanges = [];
  const opaqueChanges = [];
  for (const path of [...paths].sort()) {
    const left = before.files.get(path);
    const right = after.files.get(path);
    if (left?.hash === right?.hash) continue;
    if ((left && left.content == null) || (right && right.content == null)) {
      opaqueChanges.push({ path, beforeHash: left?.hash ?? null, afterHash: right?.hash ?? null, beforeBytes: left?.bytes ?? 0, afterBytes: right?.bytes ?? 0 });
      continue;
    }
    fileChanges.push(createFileChange({
      path,
      operation: !left ? "create" : !right ? "delete" : "bash_edit",
      beforeExists: Boolean(left),
      beforeContent: left?.content ?? "",
      afterExists: Boolean(right),
      afterContent: right?.content ?? ""
    }));
  }
  return {
    fileChanges,
    opaqueChanges,
    scanTruncated: before.truncated || after.truncated,
    scannedFiles: Math.max(before.scanned, after.scanned)
  };
}

export async function trackWorkspaceMutation(root, operation, options) {
  const before = await snapshotWorkspace(root, options);
  const result = await operation();
  const after = await snapshotWorkspace(root, options);
  return { result, mutation: diffWorkspaceSnapshots(before, after) };
}
