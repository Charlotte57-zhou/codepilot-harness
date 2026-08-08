import { readFile } from "node:fs/promises";
import { join } from "node:path";

const candidates = ["AGENTS.md", "AGENT.md", ".codepilot/AGENTS.md", ".codepilot/AGENT.md"];

export async function loadProjectRules(workspaceRoot, maxChars = 8_000) {
  const sections = [];
  for (const relativePath of candidates) {
    try {
      const content = await readFile(join(workspaceRoot, relativePath), "utf8");
      sections.push({ path: relativePath, content: content.slice(0, maxChars), truncated: content.length > maxChars });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return {
    path: sections.map((section) => section.path).join(", ") || "AGENT.md",
    content: sections.map((section) => `## ${section.path}\n${section.content}`).join("\n\n"),
    truncated: sections.some((section) => section.truncated)
  };
}
