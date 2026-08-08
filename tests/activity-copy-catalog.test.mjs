import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_COPY_CATALOGS,
  ACTIVITY_COPY_CATALOG_VERSION,
  activityCopy
} from "../public/activity-copy-catalog.js";

const required = ["running", "completed", "failed", "cancelled"];

test("each activity copy key has terminal and active forms in both locales", () => {
  assert.equal(ACTIVITY_COPY_CATALOG_VERSION, 1);
  const keys = Object.keys(ACTIVITY_COPY_CATALOGS["zh-CN"]);
  assert.deepEqual(Object.keys(ACTIVITY_COPY_CATALOGS.en), keys);
  for (const locale of ["zh-CN", "en"]) {
    for (const key of keys) {
      for (const status of required) assert.ok(ACTIVITY_COPY_CATALOGS[locale][key][status], `${locale}/${key}/${status}`);
    }
  }
});

test("copy lookup uses semantic keys and has a bounded generic fallback", () => {
  assert.equal(activityCopy("command.run", "completed"), "已运行命令");
  assert.equal(activityCopy("file.create", "failed"), "创建文件失败");
  assert.equal(activityCopy("future.unknown", "running"), "正在执行工具");
  assert.equal(activityCopy("command.run", "completed", "en"), "Ran command");
});

