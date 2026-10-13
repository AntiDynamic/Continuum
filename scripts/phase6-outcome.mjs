/**
 * Keep benchmark outcome semantics separate from provider/agent process
 * status. A provider can time out after producing a valid, fully verified
 * patch; that patch is useful evidence, but it is not a completed success for
 * the primary effectiveness metric.
 */
export const deriveRunOutcome = ({ agent = {}, failureCategory = null, git = {}, validation = {}, hiddenValidation = {} }) => {
  const visibleValidationPassed = validation.status === "passed" && validation.scope?.status === "passed" && validation.behavioral === true;
  const hiddenValidationPassed = hiddenValidation.status === "passed" && hiddenValidation.behavioral === true;
  const diffCheckPassed = git.diffCheckExitCode === 0;
  const patchValidated = Boolean(git.changed) && diffCheckPassed && visibleValidationPassed && hiddenValidationPassed;
  const timedOut = agent.status === "TIMEOUT" || failureCategory === "agent_timeout" || failureCategory === "provider_timeout";
  const providerTimeout = failureCategory === "provider_timeout";
  const providerFailure = typeof failureCategory === "string" && failureCategory.startsWith("provider_");
  const agentFinishedWithinTimeout = agent.exitCode === 0
    && !timedOut
    && !providerFailure
    && !["ERROR", "TIMEOUT", "partial"].includes(agent.status);

  return {
    patchValidated,
    visibleValidationPassed,
    hiddenValidationPassed,
    diffCheckPassed,
    agentFinishedWithinTimeout,
    timedOut,
    providerTimeout,
    providerFailure,
    failureCategory,
    verifiedTaskSuccess: patchValidated && agentFinishedWithinTimeout,
  };
};
