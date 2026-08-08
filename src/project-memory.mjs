import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function loadProjectMemory(workspaceRoot, maxChars = 6_000) {
  const path = join(workspaceRoot, ".codepilot", "MEMORY.md");
  try {
    const content = await readFile(path, "utf8");
    return { path: ".codepilot/MEMORY.md", content: content.slice(0, maxChars), truncated: content.length > maxChars };
  } catch (error) {
    if (error?.code === "ENOENT") return { path: ".codepilot/MEMORY.md", content: "", truncated: false };
    throw error;
  }
}
