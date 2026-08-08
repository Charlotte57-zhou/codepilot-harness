export class HttpBodyError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "HttpBodyError";
    this.statusCode = statusCode;
  }
}

export async function readJsonBody(request, { maxBytes = 1_048_576 } = {}) {
  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes) throw new HttpBodyError("Request body is too large", 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpBodyError("Request body must be valid JSON", 400);
  }
}
