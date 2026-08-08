import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";

const mimeByExtension = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
});

function safeArtifactId(value) {
  return /^[a-f0-9-]{36}\.(png|jpg|jpeg|webp)$/i.test(String(value ?? ""));
}

export class AutomationArtifactStore {
  constructor({ workspaceRoot, now = Date.now, createId = randomUUID } = {}) {
    if (!workspaceRoot) throw new TypeError("AutomationArtifactStore requires workspaceRoot");
    this.root = join(workspaceRoot, ".codepilot", "artifacts", "automation");
    this.now = now;
    this.createId = createId;
    this.metadata = new Map();
  }

  async saveImage(buffer, { kind, sessionId, width, height, extension = ".png" } = {}) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new TypeError("Artifact image buffer is required");
    const artifactId = `${this.createId()}${extension}`;
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `.${artifactId}.${process.pid}.tmp`);
    const destination = join(this.root, artifactId);
    await writeFile(temporary, buffer);
    await rename(temporary, destination);
    return this.#record(artifactId, buffer, { kind, sessionId, width, height });
  }

  async reserveImagePath({ extension = ".png" } = {}) {
    const artifactId = `${this.createId()}${extension}`;
    await mkdir(this.root, { recursive: true });
    return { artifactId, absolutePath: join(this.root, artifactId) };
  }

  async commitReserved(artifactId, details = {}) {
    const absolutePath = this.resolvePath(artifactId);
    const buffer = await readFile(absolutePath);
    return this.#record(artifactId, buffer, details);
  }

  resolvePath(artifactId) {
    if (!safeArtifactId(artifactId)) {
      const error = new Error("Invalid automation artifact id");
      error.statusCode = 400;
      throw error;
    }
    const absolutePath = resolve(this.root, artifactId);
    if (!absolutePath.startsWith(resolve(this.root))) throw new Error("Artifact path escaped its root");
    return absolutePath;
  }

  async read(artifactId) {
    const absolutePath = this.resolvePath(artifactId);
    const [buffer, fileStat] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    return {
      buffer,
      contentType: mimeByExtension[extname(artifactId).toLowerCase()] ?? "application/octet-stream",
      size: fileStat.size,
      metadata: this.metadata.get(artifactId) ?? null
    };
  }

  #record(artifactId, buffer, details) {
    const record = Object.freeze({
      artifactId,
      kind: details.kind ?? "automation_screenshot",
      sessionId: details.sessionId ?? null,
      width: Number(details.width) || null,
      height: Number(details.height) || null,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      createdAt: new Date(this.now()).toISOString(),
      url: `/api/automation/artifacts/${artifactId}`
    });
    this.metadata.set(artifactId, record);
    return record;
  }
}
