import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import {analyzeRecoveryUsage} from "./recovery-usage-analysis.mjs";

test("saved real response usage separates cached input from uncached without estimates",async()=>{
  const result=await analyzeRecoveryUsage(fileURLToPath(new URL("../docs/phase-next/first-real-smoke-2026-10-13",import.meta.url)));
  assert.deepEqual(result.totals,{inputTokens:25807,cachedInputTokens:12032,uncachedInputTokens:13775,outputTokens:245,totalTokens:26052});
  assert.equal(result.providerReportedResponses.length,2);assert.equal(result.providerReportedResponses[0].uncachedInputTokens,12784);assert.equal(result.providerReportedResponses[1].uncachedInputTokens,991);
  assert.deepEqual(result.visibleContext.continuumTurnInputs,[154,3360]);assert.equal(result.visibleContext.hostBaseInstructions,17730);assert.equal(result.inferenceRequests,0);
});
