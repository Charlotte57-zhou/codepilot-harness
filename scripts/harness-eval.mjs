import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateHarnessEvents } from "../src/harness-eval.mjs";

const sessionsDir = join(process.cwd(), ".codepilot", "sessions");
const files = (await readdir(sessionsDir)).filter((name) => name.endsWith(".jsonl"));
const events = [];
for (const file of files) {
  const lines = (await readFile(join(sessionsDir, file), "utf8")).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try { events.push(JSON.parse(line)); } catch {}
  }
}
const report = { generatedAt: new Date().toISOString(), sessionFiles: files.length, ...evaluateHarnessEvents(events) };
const destination = join(process.cwd(), ".codepilot", "harness-eval.json");
await writeFile(destination, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
