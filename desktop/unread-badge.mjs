export function normalizeUnreadCount(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(99, Math.trunc(Number(value))));
}

export function unreadBadgeLabel(count) {
  const normalized = normalizeUnreadCount(count);
  return normalized > 9 ? "9+" : String(normalized);
}

export function createUnreadBadgeSvg(count) {
  const normalized = normalizeUnreadCount(count);
  const label = unreadBadgeLabel(normalized);
  const fontSize = label.length > 1 ? 8 : 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.5" fill="#2787f5" stroke="#ffffff" stroke-width="1"/><text x="8" y="11.2" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${label}</text></svg>`;
}
