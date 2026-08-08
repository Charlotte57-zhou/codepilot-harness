import { PreviewArtifactTool } from "./preview-artifact-tool.mjs";
import { ToolRegistry } from "./tool-registry.mjs";

export function createCodePilotToolRegistry({ additionalTools = [] } = {}) {
  return new ToolRegistry([PreviewArtifactTool, ...additionalTools]);
}
