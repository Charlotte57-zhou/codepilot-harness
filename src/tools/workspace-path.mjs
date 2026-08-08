import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { toolError } from "./tool-result.mjs";

function isInside(rootPath, candidatePath) {
  const relation = relative(rootPath, candidatePath);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

export async function resolveWorkspacePath(workspaceRoot, requestedPath) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot) {
    return { ok: false, result: toolError("WORKSPACE_ROOT_REQUIRED", "Tool execution requires a workspaceRoot") };
  }

  let rootPath;
  try {
    rootPath = await realpath(workspaceRoot);
  } catch (error) {
    return { ok: false, result: toolError("WORKSPACE_ROOT_INVALID", "workspaceRoot could not be resolved", { code: error.code }) };
  }

  const requested = requestedPath || ".";
  const lexicalPath = resolve(rootPath, requested);
  if (!isInside(rootPath, lexicalPath)) {
    return { ok: false, result: toolError("PATH_OUTSIDE_WORKSPACE", "Requested path is outside workspaceRoot", { path: requested }) };
  }

  let resolvedPath;
  try {
    resolvedPath = await realpath(lexicalPath);
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, result: toolError("PATH_NOT_FOUND", "Requested path does not exist", { path: requested }) };
    return { ok: false, result: toolError("PATH_RESOLUTION_FAILED", "Requested path could not be resolved", { path: requested, code: error.code }) };
  }

  if (!isInside(rootPath, resolvedPath)) {
    return { ok: false, result: toolError("PATH_OUTSIDE_WORKSPACE", "Requested path resolves outside workspaceRoot", { path: requested }) };
  }

  return { ok: true, rootPath, absolutePath: resolvedPath, relativePath: relative(rootPath, resolvedPath) || "." };
}

/**
 * Resolves a file that may not exist yet while retaining the workspace and
 * symlink protections used by read operations. Missing parent directories are
 * deliberately rejected; creating a directory tree is a separate capability.
 */
export async function resolveWorkspaceWritePath(workspaceRoot, requestedPath) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot) {
    return { ok: false, result: toolError("WORKSPACE_ROOT_REQUIRED", "Tool execution requires a workspaceRoot") };
  }

  let rootPath;
  try {
    rootPath = await realpath(workspaceRoot);
  } catch (error) {
    return { ok: false, result: toolError("WORKSPACE_ROOT_INVALID", "workspaceRoot could not be resolved", { code: error.code }) };
  }

  const lexicalPath = resolve(rootPath, requestedPath);
  if (!isInside(rootPath, lexicalPath) || lexicalPath === rootPath) {
    return { ok: false, result: toolError("PATH_OUTSIDE_WORKSPACE", "Requested write path is outside workspaceRoot", { path: requestedPath }) };
  }

  try {
    const resolvedPath = await realpath(lexicalPath);
    if (!isInside(rootPath, resolvedPath)) {
      return { ok: false, result: toolError("PATH_OUTSIDE_WORKSPACE", "Requested path resolves outside workspaceRoot", { path: requestedPath }) };
    }
    return { ok: true, rootPath, absolutePath: resolvedPath, relativePath: relative(rootPath, resolvedPath), exists: true };
  } catch (error) {
    if (error.code !== "ENOENT") {
      return { ok: false, result: toolError("PATH_RESOLUTION_FAILED", "Requested path could not be resolved", { path: requestedPath, code: error.code }) };
    }
  }

  const parentPath = dirname(lexicalPath);
  try {
    const resolvedParent = await realpath(parentPath);
    if (!isInside(rootPath, resolvedParent) || !(await stat(resolvedParent)).isDirectory()) {
      return { ok: false, result: toolError("PARENT_DIRECTORY_INVALID", "Write target parent must be a workspace directory", { path: requestedPath }) };
    }
  } catch (error) {
    return { ok: false, result: toolError("PARENT_DIRECTORY_NOT_FOUND", "Write target parent directory does not exist", { path: requestedPath, code: error.code }) };
  }

  return { ok: true, rootPath, absolutePath: lexicalPath, relativePath: relative(rootPath, lexicalPath), exists: false };
}

/**
 * Resolves a directory target that may contain multiple missing path segments.
 * The closest existing ancestor is resolved through the filesystem first, so
 * recursive creation cannot cross workspaceRoot through a symlink.
 */
export async function resolveWorkspaceDirectoryPath(workspaceRoot, requestedPath) {
  if (typeof workspaceRoot !== "string" || !workspaceRoot) {
    return { ok: false, result: toolError("WORKSPACE_ROOT_REQUIRED", "Tool execution requires a workspaceRoot") };
  }
  let rootPath;
  try {
    rootPath = await realpath(workspaceRoot);
  } catch (error) {
    return { ok: false, result: toolError("WORKSPACE_ROOT_INVALID", "workspaceRoot could not be resolved", { code: error.code }) };
  }
  const requested = requestedPath || ".";
  const lexicalPath = resolve(rootPath, requested);
  if (!isInside(rootPath, lexicalPath) || lexicalPath === rootPath) {
    return { ok: false, result: toolError("PATH_OUTSIDE_WORKSPACE", "Requested directory path is outside workspaceRoot", { path: requested }) };
  }
  try {
    const resolvedPath = await realpath(lexicalPath);
    if (!isInside(rootPath, resolvedPath)) {
      return { ok: false, result: toolError("PATH_OUTSIDE_WORKSPACE", "Requested path resolves outside workspaceRoot", { path: requested }) };
    }
    if (!(await stat(resolvedPath)).isDirectory()) {
      return { ok: false, result: toolError("NOT_A_DIRECTORY", "CreateDirectory requires a directory path", { path: requested }) };
    }
    return { ok: true, rootPath, absolutePath: resolvedPath, relativePath: relative(rootPath, resolvedPath), exists: true };
  } catch (error) {
    if (error.code !== "ENOENT") {
      return { ok: false, result: toolError("PATH_RESOLUTION_FAILED", "Requested directory path could not be resolved", { path: requested, code: error.code }) };
    }
  }
  let ancestor = dirname(lexicalPath);
  while (ancestor !== rootPath) {
    try {
      const resolvedAncestor = await realpath(ancestor);
      if (!isInside(rootPath, resolvedAncestor) || !(await stat(resolvedAncestor)).isDirectory()) {
        return { ok: false, result: toolError("PARENT_DIRECTORY_INVALID", "Directory parent must be inside workspaceRoot", { path: requested }) };
      }
      break;
    } catch (error) {
      if (error.code !== "ENOENT") {
        return { ok: false, result: toolError("PATH_RESOLUTION_FAILED", "Directory parent could not be resolved", { path: requested, code: error.code }) };
      }
      ancestor = dirname(ancestor);
    }
  }
  return { ok: true, rootPath, absolutePath: lexicalPath, relativePath: relative(rootPath, lexicalPath), exists: false };
}
