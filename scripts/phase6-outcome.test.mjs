#!/usr/bin/env node
import assert from "node:assert/strict";
import { deriveRunOutcome } from "./phase6-outcome.mjs";

const validPatch = {
  agent: { exitCode: 0, status: "TIMEOUT" },
  failureCategory: "provider_timeout",
  git: { changed: true, diffCheckExitCode: 0 },
  validation: { status: "passed", behavioral: true, scope: { status: "passed" } },
  hiddenValidation: { status: "passed", behavioral: true },
};

const timedOutPatch = deriveRunOutcome(validPatch);
assert.equal(timedOutPatch.patchValidated, true);
assert.equal(timedOutPatch.providerTimeout, true);
assert.equal(timedOutPatch.agentFinishedWithinTimeout, false);
assert.equal(timedOutPatch.verifiedTaskSuccess, false);

const completedPatch = deriveRunOutcome({
  ...validPatch,
  agent: { exitCode: 0, status: "SUCCESS" },
  failureCategory: null,
});
assert.equal(completedPatch.patchValidated, true);
assert.equal(completedPatch.agentFinishedWithinTimeout, true);
assert.equal(completedPatch.verifiedTaskSuccess, true);

const invalidPatch = deriveRunOutcome({
  agent: { exitCode: 0, status: "SUCCESS" },
  git: { changed: true, diffCheckExitCode: 0 },
  validation: { status: "failed", scope: { status: "passed" } },
  hiddenValidation: { status: "passed", behavioral: true },
});
assert.equal(invalidPatch.patchValidated, false);
assert.equal(invalidPatch.verifiedTaskSuccess, false);

console.log("phase6 outcome tests passed");
