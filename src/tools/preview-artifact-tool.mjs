import { stat } from "node:fs/promises";
import { z } from "zod";
import { workspacePreviewUrl } from "../workspace-preview-server.mjs";
import { buildTool } from "./tool-contract.mjs";
import { toolError, toolSuccess, withContextProjection } from "./tool-result.mjs";
import { resolveWorkspacePath } from "./workspace-path.mjs";

export const PreviewArtifactTool = buildTool({
  name: "PreviewArtifact",
  description: "Resolve an existing workspace HTML file to the isolated CodePilot preview URL. For user-visible web work, call this after the latest edit, navigate to the exact returned URL, then collect BrowserInspect and BrowserScreenshot receipts. Interactive work must also exercise a key action and repeat both observations.",
  inputSchema: z.object({ path: z.string().min(1).max(2_000) }).strict(),
  isReadOnly: true,
  isConcurrencySafe: true,
  validateInput: async (input, context) => {
    const resolved = await resolveWorkspacePath(context.workspaceRoot, input.path);
    if (!resolved.ok) return resolved.result;
    try {
      if (!(await stat(resolved.absolutePath)).isFile()) return toolError("PATH_NOT_FILE", "PreviewArtifact requires an existing file", { path: input.path });
    } catch {
      return toolError("PATH_NOT_FOUND", "PreviewArtifact requires an existing file", { path: input.path });
    }
    if (!/\.html?$/i.test(input.path)) return toolError("PREVIEW_TYPE_UNSUPPORTED", "PreviewArtifact currently supports HTML files", { path: input.path });
    if (!context?.workspacePreviewOrigin) return toolError("PREVIEW_RUNTIME_UNAVAILABLE", "Workspace preview runtime is not available for this run", { path: input.path });
  },
  preparePermissionMatcher: async (input) => ({ toolName: "PreviewArtifact", operation: "preview", path: input.path }),
  renderToolUseMessage: (input) => ({ title: "准备网页预览", detail: input.path }),
  async call(input, context) {
    const resolved = await resolveWorkspacePath(context.workspaceRoot, input.path);
    if (!resolved.ok) return resolved.result;
    const url = workspacePreviewUrl(context.workspacePreviewOrigin, resolved.relativePath);
    return withContextProjection(toolSuccess(`Preview URL: ${url}`, {
      kind: "workspace_preview",
      path: resolved.relativePath,
      url
    }), { kind: "workspace_preview", path: resolved.relativePath, url });
  }
});
