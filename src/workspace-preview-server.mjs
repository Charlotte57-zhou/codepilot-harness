import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { resolveWorkspacePath } from "./tools/workspace-path.mjs";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

export const previewContentSecurityPolicy = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

export function workspacePreviewUrl(origin, relativePath) {
  if (!origin || !relativePath) return null;
  const encoded = String(relativePath).replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
  return `${String(origin).replace(/\/$/, "")}/preview/${encoded}`;
}

export function createWorkspacePreviewServer({ workspaceRoot, port = 0 } = {}) {
  if (!workspaceRoot) throw new TypeError("workspace preview requires workspaceRoot");
  let origin = null;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (request.method !== "GET" || !url.pathname.startsWith("/preview/")) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const requested = decodeURIComponent(url.pathname.slice("/preview/".length));
      let resolved = await resolveWorkspacePath(workspaceRoot, requested);
      if (!resolved.ok) {
        response.writeHead(resolved.result?.error?.code === "PATH_NOT_FOUND" ? 404 : 403);
        response.end("Preview target unavailable");
        return;
      }
      if ((await stat(resolved.absolutePath)).isDirectory()) {
        resolved = await resolveWorkspacePath(workspaceRoot, join(resolved.relativePath, "index.html"));
      }
      if (!resolved.ok || !(await stat(resolved.absolutePath)).isFile()) {
        response.writeHead(404);
        response.end("Preview target unavailable");
        return;
      }
      const file = await readFile(resolved.absolutePath);
      response.writeHead(200, {
        "content-type": contentTypes[extname(resolved.absolutePath).toLowerCase()] ?? "application/octet-stream",
        "content-length": file.length,
        "cache-control": "no-store, max-age=0",
        "content-security-policy": previewContentSecurityPolicy,
        "cross-origin-opener-policy": "same-origin",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff"
      });
      response.end(file);
    } catch {
      response.writeHead(400);
      response.end("Invalid preview request");
    }
  });

  return {
    server,
    get origin() { return origin; },
    async listen() {
      if (origin) return origin;
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      const address = server.address();
      origin = `http://127.0.0.1:${address.port}`;
      return origin;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
      origin = null;
    }
  };
}
