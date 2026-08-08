import assert from "node:assert/strict";
import test from "node:test";
import { ProviderAuxiliaryClient } from "../src/provider-auxiliary-client.mjs";

test("auxiliary visual request uses Anthropic Messages without creating another Agent Loop", async () => {
  let request;
  const client = new ProviderAuxiliaryClient({
    apiKey: "TOKEN",
    baseUrl: "https://provider.test/v1",
    model: "MODEL",
    capabilities: { input: { text: true, image: true, pdf: false }, toolCalling: false },
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        id: "aux-1",
        model: "MODEL",
        content: [{ type: "text", text: "{\"accepted\":true}" }],
        usage: { input_tokens: 10, output_tokens: 4 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const result = await client.complete({
    messages: [
      { role: "system", content: "Review" },
      {
        role: "user",
        content: "Screenshot",
        attachments: [{ origin: "upload", kind: "image", mediaType: "image/png", data: "aW1hZ2U=" }]
      }
    ]
  });
  assert.equal(request.url, "https://provider.test/v1/messages");
  assert.equal(request.body.messages[0].content[1].type, "image");
  assert.equal(result.text, "{\"accepted\":true}");
  assert.equal("tools" in request.body, false);
});
