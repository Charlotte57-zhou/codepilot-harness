import test from "node:test";
import assert from "node:assert/strict";
import { createProviderVisualReviewer, extractJson } from "../src/provider-visual-reviewer.mjs";

test("provider visual reviewer sends the screenshot as native image evidence", async () => {
  let request;
  const reviewer = createProviderVisualReviewer({
    modelClient: {
      capabilities: { input: { image: true } },
      providerName: "fixture",
      async complete(value) { request = value; return { text: '{"accepted":true,"summary":"布局正常","issues":[]}' }; }
    },
    artifactStore: { async read() { return { buffer: Buffer.from("png"), contentType: "image/png" }; } }
  });
  const result = await reviewer({ artifactId: "shot.png", revision: 3, task: "创建网页" });
  assert.equal(result.metadata.accepted, true);
  assert.equal(request.messages[1].attachments[0].kind, "image");
  assert.equal(result.metadata.revision, 3);
});

test("visual review JSON extraction rejects prose without a verdict", () => {
  assert.equal(extractJson("no json"), null);
});
