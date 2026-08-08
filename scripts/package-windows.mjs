import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const outputRoot = join(projectRoot, "dist");
const stagingRoot = await mkdtemp(join(tmpdir(), "codepilot-build-"));

function runBuilder() {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [
      join(projectRoot, "node_modules", "electron-builder", "cli.js"),
      "--win",
      "portable",
      "--publish",
      "never",
      `--config.directories.output=${stagingRoot}`
    ], { cwd: projectRoot, stdio: "inherit", windowsHide: true });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0 ? resolveRun() : rejectRun(new Error(`electron-builder exited with code ${code}`)));
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertPortableExecutable(path) {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(2);
    await handle.read(header, 0, 2, 0);
    if (header[0] !== 0x4d || header[1] !== 0x5a) throw new Error("Portable artifact is not a Windows PE executable");
  } finally {
    await handle.close();
  }
}

try {
  await runBuilder();
  const artifacts = (await readdir(stagingRoot)).filter((name) => name.endsWith("-portable.exe"));
  if (artifacts.length !== 1) throw new Error(`Expected one portable executable, found ${artifacts.length}`);
  const source = join(stagingRoot, artifacts[0]);
  await assertPortableExecutable(source);
  await mkdir(outputRoot, { recursive: true });
  const target = join(outputRoot, basename(source));
  await copyFile(source, target);
  const metadata = await stat(target);
  const digest = await sha256(target);
  await writeFile(join(outputRoot, "SHA256SUMS.txt"), `${digest}  ${basename(target)}\n`, "utf8");
  console.log(JSON.stringify({ artifact: target, bytes: metadata.size, sha256: digest }));
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
