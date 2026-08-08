import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readJsonBody } from "../src/http-body.mjs";

test("readJsonBody parses JSON and rejects malformed or oversized bodies", async () => {
  assert.deepEqual(await readJsonBody(Readable.from([Buffer.from('{"ok":true}')])), { ok: true });
  await assert.rejects(() => readJsonBody(Readable.from([Buffer.from("not-json")])), (error) => error.statusCode === 400);
  await assert.rejects(() => readJsonBody(Readable.from([Buffer.from("12345")]), { maxBytes: 4 }), (error) => error.statusCode === 413);
});
