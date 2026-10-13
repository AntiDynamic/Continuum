import { deriveRunOutcome } from "./phase6-outcome.mjs";
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const median = values => { const sorted = values.filter(x => x !== null).sort((a,b) => a-b); const n = sorted.length; return n ? n % 2 ? sorted[Math.floor(n/2)] : (sorted[n/2-1]+sorted[n/2])/2 : null; };
function interval(values) {
  const usable = values.filter(x => x !== null);
  if (usable.length < 2) return { low: null, high: null, samples: usable.length, statistic: "median" };
  let seed = 20261012;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2**32; };
  const samples = Array.from({ length: 2000 }, () => median(usable.map(() => usable[Math.floor(random()*usable.length)]))).sort((a,b) => a-b);
  return { low: samples[50], high: samples[1949], samples: samples.length, statistic: "median" };
}
function metric(result) {
  const usage = result.agent?.usage;
  const outcome = deriveRunOutcome({ agent: result.agent, failureCategory: result.agent?.failureCategory, git: result.git, validation: result.validation, hiddenValidation: result.hiddenValidation });
  return { ...outcome, inputTokens: number(usage?.inputTokens), cachedInputTokens: number(usage?.cacheReadTokens), outputTokens: number(usage?.outputTokens), thinkingTokens: number(usage?.thinkingTokens), totalTokens: number(usage?.totalTokens), cost: number(result.agent?.cost?.total), durationMs: number(result.agent?.durationMs) };
}
function summary(items) {
  const eligible = items.filter(x => x.eligible), successes = eligible.filter(x => x.metric.verifiedTaskSuccess).length;
  const costs = eligible.map(x => x.metric.cost), tokens = eligible.map(x => x.metric.totalTokens), duration = eligible.map(x => x.metric.durationMs);
  const stats = values => ({ median: median(values), measured: values.filter(x => x !== null).length });
  return { runs: items.length, eligibleRuns: eligible.length, excludedRuns: items.length-eligible.length, verifiedSuccesses: successes, verifiedSuccessRate: eligible.length ? successes/eligible.length : null, validatedPatches: eligible.filter(x => x.metric.patchValidated).length, validatedPatchRate: eligible.length ? eligible.filter(x => x.metric.patchValidated).length/eligible.length : null, completedAgents: eligible.filter(x => x.metric.agentFinishedWithinTimeout).length, providerTimeouts: items.filter(x => x.metric.providerTimeout).length, cost: stats(costs), totalTokens: stats(tokens), durationMs: stats(duration), costPerVerifiedSuccess: successes && costs.every(x => x !== null) ? costs.reduce((a,b) => a+b,0)/successes : null };
}
function delta(pairs,key) {
  const values = pairs.map(pair => pair.on.metric[key] === null || pair.off.metric[key] === null ? null : Number(pair.on.metric[key])-Number(pair.off.metric[key]));
  return { pairedRuns: pairs.length, measuredRuns: values.filter(x => x !== null).length, medianOnMinusOff: median(values), bootstrap95: interval(values) };
}
export function buildEffectivenessReport(entries, source = null) {
  const records = entries.filter(x => x.result?.schemaVersion === "continuum.agent-effectiveness-run.v2").map(entry => {
    const result = entry.result, failure = result.agent?.failureCategory;
    const behavioral = result.validation?.behavioral === true && result.hiddenValidation?.behavioral === true;
    return { ...result.manifest, artifactDir: entry.artifactDir ?? null, eligible: behavioral && !failure?.startsWith("provider_"), exclusion: !behavioral ? "legacy_or_missing_behavioral_validation" : failure?.startsWith("provider_") ? failure : null, metric: metric(result) };
  });
  const groups = new Map(), matched = new Set();
  for (const record of records) {
    const key = JSON.stringify([record.agent ?? "agy",record.model,record.taskId,record.repetition]);
    if (!groups.has(key)) groups.set(key,new Map());
    if (groups.get(key).has(record.treatment)) throw new Error("Duplicate experiment cell: " + key + "/" + record.treatment);
    groups.get(key).set(record.treatment,record);
  }
  const definitions = [["continuum_off","continuum_on"],["continuum_off","continuum_preflight_only"],["continuum_off","continuum_preflight"],["continuum_preflight_only","continuum_preflight"]];
  const comparisons = definitions.map(([control,treatment]) => {
    const pairs = [...groups.values()].filter(group => group.has(control) && group.has(treatment)).map(group => ({ off:group.get(control),on:group.get(treatment) }));
    for (const pair of pairs) { matched.add(pair.off); matched.add(pair.on); }
    const eligible = pairs.filter(pair => pair.off.eligible && pair.on.eligible);
    const models = [...new Set(pairs.map(pair => JSON.stringify([pair.off.agent??"agy",pair.off.model])))];
    const byModel = models.map(key => {
      const [agent,model] = JSON.parse(key), selected = eligible.filter(pair => (pair.off.agent??"agy") === agent && pair.off.model === model);
      return { agent,model,pairs:selected.length,control:summary(selected.map(x=>x.off)),treatment:summary(selected.map(x=>x.on)),delta:Object.fromEntries(["verifiedTaskSuccess","totalTokens","cost","durationMs"].map(field=>[field,delta(selected,field)])) };
    });
    return { control,treatment,pairedRuns:pairs.length,eligiblePairs:eligible.length,excludedPairs:pairs.length-eligible.length,byModel };
  });
  return { schemaVersion:"continuum.phase6-effectiveness-report.v2",generatedAt:new Date().toISOString(),sourceManifest:source,records:records.length,infrastructureFailures:entries.filter(x=>x.status==="infrastructure_failure").length,providerFailures:records.filter(x=>x.exclusion?.startsWith("provider_")).length,exclusions:records.filter(x=>!x.eligible).map(x=>({taskId:x.taskId,treatment:x.treatment,reason:x.exclusion})),comparisons,pairedRuns:comparisons[0].pairedRuns,preflightOnlyPairedRuns:comparisons[1].pairedRuns,preflightPairedRuns:comparisons[2].pairedRuns,preflightMcpPairedRuns:comparisons[3].pairedRuns,unpairedRuns:records.length-matched.size,overall:Object.fromEntries(["continuum_off","continuum_on","continuum_preflight_only","continuum_preflight"].map(arm=>[arm,summary(records.filter(x=>x.treatment===arm))])),pairedByModel:comparisons[0].byModel,preflightOnlyPairedByModel:comparisons[1].byModel,preflightPairedByModel:comparisons[2].byModel,preflightOnlyVsMcpByModel:comparisons[3].byModel,decisionReady:false };
}
