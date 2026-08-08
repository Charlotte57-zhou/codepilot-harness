function runIdOf(event) { return event?.data?.runId ?? null; }

export function evaluateHarnessEvents(events = []) {
  const runs = new Map();
  for (const event of events) {
    const runId = runIdOf(event);
    if (!runId) continue;
    const run = runs.get(runId) ?? {
      runId, contract: null, mutations: 0, bashTrackedMutations: 0, gateAccepted: false,
      gateRejected: 0, gateObserved: false, final: false, terminal: null, visualEvidence: new Set(), providerVision: false
    };
    if (event.type === "runtime_options_frozen") run.contract = event.data.deliveryContract ?? null;
    if (event.type === "tool_completed" && event.data.ok) {
      const changes = [event.data.metadata?.fileChange, ...(event.data.metadata?.fileChanges ?? [])].filter(Boolean);
      run.mutations += changes.length;
      if (event.data.tool === "Bash" || event.data.tool === "WorkspaceDiff") run.bashTrackedMutations += changes.length;
    }
    if (event.type === "delivery_evidence_recorded" && event.data.ok) run.visualEvidence.add(event.data.tool);
    if (event.type === "provider_visual_review_completed" && event.data.accepted) run.providerVision = true;
    if (event.type === "completion_gate_evaluated") {
      run.gateObserved = true;
      if (event.data.accepted) run.gateAccepted = true;
      else run.gateRejected += 1;
    }
    if (event.type === "agent_final") run.final = true;
    if (event.type === "run_state_changed" && ["completed", "failed", "cancelled"].includes(event.data.to)) run.terminal = event.data.to;
    runs.set(runId, run);
  }
  const values = [...runs.values()];
  const completed = values.filter((run) => run.final || run.terminal === "completed");
  const contractMissing = values.filter((run) => !run.contract);
  const escapeRuns = completed.filter((run) => !run.gateAccepted);
  const visualRuns = values.filter((run) => ["web", "interactive_web"].includes(run.contract?.artifact?.kind));
  const visuallyVerified = visualRuns.filter((run) => {
    const required = ["PreviewArtifact", "BrowserNavigate", "BrowserInspect", "BrowserScreenshot"];
    if (run.contract?.verification?.requireInteraction) required.push("BrowserClick");
    return required.every((name) => run.visualEvidence.has(name)) || run.gateAccepted;
  });
  const inconsistentTerminal = values.filter((run) => run.final && run.terminal && run.terminal !== "completed");
  return {
    schemaVersion: 2,
    runCount: values.length,
    completedCount: completed.length,
    contractMissingCount: contractMissing.length,
    completionEscapeCount: escapeRuns.length,
    completionEscapeRate: completed.length ? escapeRuns.length / completed.length : 0,
    visualRunCount: visualRuns.length,
    visualVerificationRate: visualRuns.length ? visuallyVerified.length / visualRuns.length : 1,
    mutationCount: values.reduce((sum, run) => sum + run.mutations, 0),
    bashTrackedMutationCount: values.reduce((sum, run) => sum + run.bashTrackedMutations, 0),
    gateRejectionCount: values.reduce((sum, run) => sum + run.gateRejected, 0),
    terminalInconsistencyCount: inconsistentTerminal.length,
    contractMissingRunIds: contractMissing.map((run) => run.runId),
    escapeRunIds: escapeRuns.map((run) => run.runId),
    inconsistentRunIds: inconsistentTerminal.map((run) => run.runId)
  };
}
