import assert from "node:assert/strict";
import test from "node:test";
import { classifyModelError } from "../src/model-retry.mjs";

test("product error projection classifies SDK/provider failures without owning retries", () => {
  assert.equal(classifyModelError(Object.assign(new Error("busy"), { status: 429 })).category, "rate_limit");
  assert.equal(classifyModelError(Object.assign(new Error("bad key"), { status: 401 })).retryable, false);
  assert.equal(classifyModelError(Object.assign(new Error("unavailable"), { status: 503 })).retryable, true);
  const dns = new Error("network");
  dns.cause = { code: "ENOTFOUND" };
  assert.equal(classifyModelError(dns).networkReason, "dns");
});
