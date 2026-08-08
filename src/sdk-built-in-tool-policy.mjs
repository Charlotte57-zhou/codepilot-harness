import { resolveWorkspacePath, resolveWorkspaceWritePath } from "./tools/workspace-path.mjs";

const readPathFields = Object.freeze({
  Read: ["file_path"],
  Glob: ["path"],
  Grep: ["path"]
});

const writePathFields = Object.freeze({
  Write: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  NotebookEdit: ["notebook_path"]
});

function requestedPaths(input, fields, { defaultPath } = {}) {
  const values = fields
    .map((field) => input?.[field])
    .filter((value) => typeof value === "string" && value.trim());
  if (!values.length && defaultPath !== undefined) return [defaultPath];
  return values;
}

function denial(toolName, path, result) {
  const error = result?.error ?? {};
  return {
    behavior: "deny",
    message: `${toolName} rejected by workspace boundary (${error.code ?? "PATH_INVALID"}): ${error.message ?? "invalid path"}`,
    interrupt: false,
    details: { path, code: error.code ?? "PATH_INVALID" }
  };
}

/**
 * Validates path-bearing Claude Agent SDK built-ins before permission policy.
 * Bash is intentionally not parsed here: cwd and explicit approval are its
 * product boundary, not an OS sandbox or a command-string containment claim.
 */
export async function validateSdkBuiltInToolInput(toolName, input, workspaceRoot) {
  const readFields = readPathFields[toolName];
  if (readFields) {
    const paths = requestedPaths(input, readFields, { defaultPath: toolName === "Read" ? undefined : "." });
    if (!paths.length) return denial(toolName, null, { error: { code: "PATH_REQUIRED", message: "a path is required" } });
    for (const path of paths) {
      const resolved = await resolveWorkspacePath(workspaceRoot, path);
      if (!resolved.ok) return denial(toolName, path, resolved.result);
    }
  }

  const writeFields = writePathFields[toolName];
  if (writeFields) {
    const paths = requestedPaths(input, writeFields);
    if (!paths.length) return denial(toolName, null, { error: { code: "PATH_REQUIRED", message: "a path is required" } });
    for (const path of paths) {
      const resolved = await resolveWorkspaceWritePath(workspaceRoot, path);
      if (!resolved.ok) return denial(toolName, path, resolved.result);
    }
  }

  return { behavior: "allow", updatedInput: input };
}
