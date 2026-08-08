import test from "node:test";
import assert from "node:assert/strict";
import { publicRuntimeStartupDetail, runtimeProcessExited } from "../desktop/runtime-process.mjs";
import { readFile } from "node:fs/promises";

test("runtime process lifecycle supports both child and Electron utility handles", () => {
  assert.equal(runtimeProcessExited({ exitCode: null }), false);
  assert.equal(runtimeProcessExited({ exitCode: 0 }), true);
  assert.equal(runtimeProcessExited({}), false);
});

test("packaged startup errors do not render complete user or temporary paths", () => {
  const error = Object.assign(new Error("spawn C:\\Users\\local-account\\AppData\\Local\\Temp\\bundle\\CodePilot.exe ENOENT"), { code: "ENOENT" });
  const detail = publicRuntimeStartupDetail(error);
  assert.equal(detail, "The packaged Runtime process did not start (ENOENT).");
  assert.doesNotMatch(detail, /Users|AppData|local-account|Temp/);
});

test("desktop package unpacks the complete Runtime entry and resource boundary", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.build.asarUnpack, ["server.mjs", "src/**/*", "public/**/*", "node_modules/**/*"]);
});
