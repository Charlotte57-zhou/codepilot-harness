export const INSPECTOR_COMPACT_QUERY = "(max-width: 1180px)";

export function createInspectorLayout(compact) {
  const isCompact = Boolean(compact);
  return { compact: isCompact, open: false };
}

export function transitionInspectorViewport(layout, compact) {
  const isCompact = Boolean(compact);
  if (layout.compact === isCompact) return layout;
  return { ...layout, compact: isCompact };
}

export function setInspectorOpen(layout, open) {
  const nextOpen = Boolean(open);
  if (layout.open === nextOpen) return layout;
  return { ...layout, open: nextOpen };
}

export function toggleInspector(layout) {
  return setInspectorOpen(layout, !layout.open);
}
