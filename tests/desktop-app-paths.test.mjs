import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applicationModelStateRoot, bundledDemoSource, desktopUserDataPath, ensureDemoWorkspace, projectStateRoot, runtimeAppRoot } from "../desktop/app-paths.mjs";
import { localStateDirectory, modelStateDirectory } from "../src/state-root.mjs";

test("desktop state and packaged demo data live below userData", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-app-paths-"));
  try {
    const resourcesPath = join(root, "resources");
    const appRoot = join(root, "source");
    const userDataPath = join(root, "user-data");
    await mkdir(join(resourcesPath, "demo-repo"), { recursive: true });
    await writeFile(join(resourcesPath, "demo-repo", "README.md"), "seed", "utf8");

    assert.equal(bundledDemoSource({ appRoot, resourcesPath, isPackaged: true }), join(resourcesPath, "demo-repo"));
    assert.equal(projectStateRoot(userDataPath, "project-demo"), join(userDataPath, "projects", "project-demo"));
    const workspace = await ensureDemoWorkspace({ appRoot, resourcesPath, userDataPath, isPackaged: true });
    assert.equal(workspace, join(userDataPath, "demo-workspace"));
    assert.equal(await readFile(join(workspace, "README.md"), "utf8"), "seed");

    await writeFile(join(workspace, "README.md"), "user change", "utf8");
    await ensureDemoWorkspace({ appRoot, resourcesPath, userDataPath, isPackaged: true });
    assert.equal(await readFile(join(workspace, "README.md"), "utf8"), "user change");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("development uses the repository demo without copying it", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-dev-paths-"));
  try {
    const appRoot = join(root, "source");
    await mkdir(join(appRoot, "demo-repo"), { recursive: true });
    assert.equal(await ensureDemoWorkspace({
      appRoot,
      resourcesPath: join(root, "resources"),
      userDataPath: join(root, "user-data"),
      isPackaged: false
    }), join(appRoot, "demo-repo"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model configuration is application-scoped while project state remains isolated", () => {
  assert.equal(localStateDirectory({ CODEPILOT_STATE_ROOT: "C:\\state\\project-a" }, "C:\\source"), "C:\\state\\project-a\\.codepilot");
  assert.equal(modelStateDirectory({ CODEPILOT_STATE_ROOT: "C:\\state\\project-a", CODEPILOT_MODEL_STATE_ROOT: "C:\\state\\application" }, "C:\\source"), "C:\\state\\application\\.codepilot");
  assert.equal(modelStateDirectory({ CODEPILOT_STATE_ROOT: "C:\\state\\project-a" }, "C:\\source"), "C:\\state\\project-a\\.codepilot");
  assert.equal(localStateDirectory({}, "C:\\source"), "C:\\source\\.codepilot");
});

test("packaged and development shells do not share project registries or credentials", () => {
  assert.equal(desktopUserDataPath({ appDataPath: "C:\\app-data", currentUserDataPath: "C:\\app-data\\CodePilot", isPackaged: true }), "C:\\app-data\\CodePilot Desktop");
  assert.equal(desktopUserDataPath({ appDataPath: "C:\\app-data", currentUserDataPath: "C:\\app-data\\CodePilot", isPackaged: false }), "C:\\app-data\\CodePilot");
});

test("packaged utility runtime resolves only to the unpacked filesystem boundary", () => {
  assert.equal(runtimeAppRoot({ appRoot: "C:\\resources\\app.asar", resourcesPath: "C:\\resources", isPackaged: true }), "C:\\resources\\app.asar.unpacked");
  assert.equal(runtimeAppRoot({ appRoot: "C:\\source", resourcesPath: "C:\\resources", isPackaged: false }), "C:\\source");
});
