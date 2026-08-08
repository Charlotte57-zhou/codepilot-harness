const PRIMARY_VIEWS = new Set(["conversation", "skills", "mcp"]);

export function createPrimaryNavigation(view = "conversation") {
  if (!PRIMARY_VIEWS.has(view)) throw new Error(`Unknown primary view: ${view}`);
  return { view };
}

export function setPrimaryView(navigation, view) {
  if (!PRIMARY_VIEWS.has(view)) throw new Error(`Unknown primary view: ${view}`);
  if (navigation.view === view) return navigation;
  return { view };
}

export function derivePrimaryNavigation(navigation, { currentSessionId = null, candidateSessionId = null } = {}) {
  const skillsCurrent = navigation.view === "skills";
  const mcpCurrent = navigation.view === "mcp";
  return {
    skillsCurrent,
    mcpCurrent,
    sessionCurrent: !skillsCurrent
      && !mcpCurrent
      && Boolean(currentSessionId)
      && currentSessionId === candidateSessionId
  };
}
