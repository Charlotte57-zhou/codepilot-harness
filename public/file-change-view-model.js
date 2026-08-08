function splitLines(content) {
  if (!content) return [];
  return String(content).replace(/\r\n/g, "\n").split("\n");
}

const browserPreviewExtensions = new Set(["html", "htm"]);

export function previewArtifactForFile(file, previewOrigin) {
  const path = String(file?.path ?? "").trim();
  const origin = String(previewOrigin ?? "").replace(/\/$/, "");
  if (!path || !origin) return null;
  const extension = path.split(".").pop()?.toLowerCase();
  if (!browserPreviewExtensions.has(extension)) return null;
  const encodedPath = path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
  const documentTitle = String(file?.after?.content ?? "").match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
  const filename = path.replaceAll("\\", "/").split("/").pop();
  return {
    path,
    href: `${origin}/preview/${encodedPath}`,
    label: documentTitle ? `${documentTitle} · ${filename}` : filename
  };
}

export function buildLineDiff(beforeContent, afterContent) {
  const before = splitLines(beforeContent);
  const after = splitLines(afterContent);
  const rows = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (left < before.length && before[left] === after[right]) {
      rows.push({ kind: "context", beforeNumber: left + 1, afterNumber: right + 1, text: before[left] });
      left += 1;
      right += 1;
      continue;
    }
    let nextAfter = -1;
    let nextBefore = -1;
    for (let lookahead = 1; lookahead <= 24; lookahead += 1) {
      if (nextAfter < 0 && right + lookahead < after.length && before[left] === after[right + lookahead]) nextAfter = lookahead;
      if (nextBefore < 0 && left + lookahead < before.length && before[left + lookahead] === after[right]) nextBefore = lookahead;
      if (nextAfter >= 0 || nextBefore >= 0) break;
    }
    if (nextAfter >= 0 && (nextBefore < 0 || nextAfter <= nextBefore)) {
      for (let index = 0; index < nextAfter; index += 1) {
        rows.push({ kind: "addition", beforeNumber: null, afterNumber: right + 1, text: after[right] });
        right += 1;
      }
      continue;
    }
    if (nextBefore >= 0) {
      for (let index = 0; index < nextBefore; index += 1) {
        rows.push({ kind: "deletion", beforeNumber: left + 1, afterNumber: null, text: before[left] });
        left += 1;
      }
      continue;
    }
    if (left < before.length) {
      rows.push({ kind: "deletion", beforeNumber: left + 1, afterNumber: null, text: before[left] });
      left += 1;
    }
    if (right < after.length) {
      rows.push({ kind: "addition", beforeNumber: null, afterNumber: right + 1, text: after[right] });
      right += 1;
    }
  }
  return rows;
}

export function compactDiffRows(rows, context = 3) {
  const keep = new Set();
  rows.forEach((row, index) => {
    if (row.kind === "context") return;
    for (let offset = -context; offset <= context; offset += 1) keep.add(index + offset);
  });
  const result = [];
  let gap = [];
  const flushGap = () => {
    if (!gap.length) return;
    const beforeNumbers = gap.map(({ beforeNumber }) => beforeNumber).filter(Number.isInteger);
    const afterNumbers = gap.map(({ afterNumber }) => afterNumber).filter(Number.isInteger);
    result.push({
      kind: "omitted",
      count: gap.length,
      beforeStart: beforeNumbers[0] ?? null,
      beforeEnd: beforeNumbers.at(-1) ?? null,
      afterStart: afterNumbers[0] ?? null,
      afterEnd: afterNumbers.at(-1) ?? null
    });
    gap = [];
  };
  rows.forEach((row, index) => {
    if (!keep.has(index)) {
      gap.push(row);
      return;
    }
    flushGap();
    result.push(row);
  });
  flushGap();
  return result;
}

export function fileReviewMeta(file) {
  const normalizedPath = String(file?.path ?? "").replaceAll("\\", "/");
  const segments = normalizedPath.split("/").filter(Boolean);
  const name = segments.pop() ?? "未命名文件";
  const directory = segments.join("/");
  const beforeExists = file?.before?.exists !== false;
  const afterExists = file?.after?.exists !== false;
  const status = !beforeExists && afterExists ? "added" : beforeExists && !afterExists ? "deleted" : "modified";
  return { path: normalizedPath, name, directory, status };
}

export function buildRunChangeSet(events, runId) {
  const byPath = new Map();
  for (const event of events) {
    if (event.data?.runId !== runId) continue;
    const records = event.type === "tool_completed" && event.data?.ok
      ? [event.data?.metadata?.fileChange, ...(event.data?.metadata?.fileChanges ?? [])].filter(Boolean)
      : event.type === "workspace_mutation_observed"
        ? event.data?.fileChanges ?? []
        : [];
    for (const record of records) {
      const existing = byPath.get(record.path);
      if (!existing) byPath.set(record.path, { path: record.path, before: record.before, after: record.after });
      else existing.after = record.after;
    }
  }
  const files = [...byPath.values()].map((file) => {
    const rows = buildLineDiff(file.before.content, file.after.content);
    return {
      ...file,
      rows,
      additions: rows.filter(({ kind }) => kind === "addition").length,
      deletions: rows.filter(({ kind }) => kind === "deletion").length
    };
  });
  return {
    runId,
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    reverted: events.some((event) => event.type === "file_changes_reverted" && event.data?.runId === runId)
  };
}
