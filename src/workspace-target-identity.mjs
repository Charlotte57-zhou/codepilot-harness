import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const workspaceTargetIdPattern = /^target-[a-f0-9]{16}$/;

export function isWorkspaceTargetId(value) {
  return typeof value === "string" && workspaceTargetIdPattern.test(value);
}

export function workspaceTargetIdForPath(path) {
  const normalized = resolve(path);
  const identity = process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
  return `target-${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}
