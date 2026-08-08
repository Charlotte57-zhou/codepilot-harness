import test from "node:test";
import assert from "node:assert/strict";
import { redactLocalPaths } from "../public/privacy-display.js";

test("display privacy redacts user-home identities while preserving project-relative evidence", () => {
  assert.equal(redactLocalPaths("C:\\Users\\private-name\\work\\app\\src.js"), "~\\work\\app\\src.js");
  assert.equal(redactLocalPaths("/home/private-name/work/app/src.js"), "~/work/app/src.js");
  assert.equal(redactLocalPaths("src/app.js"), "src/app.js");
});
