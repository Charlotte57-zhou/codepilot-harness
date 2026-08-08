import { createServer, request as requestHttp } from "node:http";

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

function assertLoopbackPort(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new TypeError(`${label} must be a valid loopback port`);
  }
  return value;
}

function proxyHeaders(headers, { host } = {}) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!hopByHopHeaders.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  }
  if (host) result.host = host;
  return result;
}

export function isWorkspacePreviewUrl(value, previewOrigin) {
  if (!previewOrigin) return false;
  try {
    const candidate = new URL(value);
    const allowed = new URL(previewOrigin);
    return candidate.origin === allowed.origin && candidate.pathname.startsWith("/preview/");
  } catch {
    return false;
  }
}

export function createDesktopRuntimeRouter({ upstreamPort } = {}) {
  let activeUpstreamPort = assertLoopbackPort(upstreamPort, "upstreamPort");
  let origin = null;

  const server = createServer((incoming, outgoing) => {
    const port = activeUpstreamPort;
    const upstream = requestHttp({
      hostname: "127.0.0.1",
      port,
      method: incoming.method,
      path: incoming.url,
      headers: proxyHeaders(incoming.headers, { host: `localhost:${port}` })
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, proxyHeaders(response.headers));
      response.pipe(outgoing);
    });

    upstream.once("error", () => {
      if (outgoing.headersSent) {
        outgoing.destroy();
        return;
      }
      outgoing.writeHead(503, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0"
      });
      outgoing.end(JSON.stringify({ error: "CodePilot Runtime is unavailable" }));
    });
    incoming.once("aborted", () => upstream.destroy());
    outgoing.once("close", () => {
      if (!outgoing.writableEnded) upstream.destroy();
    });
    incoming.pipe(upstream);
  });

  return {
    server,
    get origin() { return origin; },
    get upstreamPort() { return activeUpstreamPort; },
    swap(nextPort) {
      activeUpstreamPort = assertLoopbackPort(nextPort, "upstreamPort");
    },
    async listen() {
      if (origin) return origin;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      origin = `http://localhost:${address.port}`;
      return origin;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
      origin = null;
    }
  };
}
