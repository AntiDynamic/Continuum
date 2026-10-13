#!/usr/bin/env node
import {readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
const finite=value=>typeof value==="number"&&Number.isFinite(value)?value:null;
export function compareRecoveryReports(reports) {
  const records=reports.flatMap(report=>{if(report.schemaVersion!=="continuum.recovery-benchmark.v1")throw new Error("Unsupported recovery report schema");return report.records;});
  const groups=new Map(),exclusions=[];
  for(const record of records){
    if(record.mode!=="live"||record.generationTurnRequests!==2||record.agentCompleted!==true||!record.validation||record.transition==="compaction"&&!record.genuineCompactions){exclusions.push({caseId:record.caseId,treatment:record.treatment,reason:record.mode!=="live"?"not_real_agent_behavior":"incomplete_or_unevidenced_execution"});continue;}
    if(record.validation.visible.behavioral!==true||record.validation.hidden.behavioral!==true)throw new Error("Non-behavioral validation cannot qualify an experiment cell.");
    const behavioralSuccess=record.validation.visible.status==="passed"&&record.validation.hidden.status==="passed";
    if(record.behavioralSuccess!==behavioralSuccess)throw new Error("Outcome contradicts independent validation.");
    const key=record.caseId+"/"+(record.repetition??1);
    if(!groups.has(key))groups.set(key,new Map());const group=groups.get(key);
    if(group.has(record.treatment))throw new Error("Duplicate experiment cell: "+key+"/"+record.treatment);
    const previous=[...group.values()][0],config=record.configuration;
    const signature=JSON.stringify([record.initialCommit,record.task,record.continuation,record.transition,config.model,config.reasoningEffort,config.approvalPolicy,config.sandbox,config.timeoutMs,config.maximumReportedTokens,config.configOverrides]);
    if(previous&&previous.signature!==signature)throw new Error("Unfair comparison: different starting commit, task, model, permissions, or resource limits: "+key);
    group.set(record.treatment,{record,signature});
  }
  const pairs=[];
  for(const [key,group] of groups)for(const [left,right] of [["A","B"],["A","C"],["B","C"]])if(group.has(left)&&group.has(right)){
    const a=group.get(left).record,b=group.get(right).record;
    const difference=field=>finite(a[field])===null||finite(b[field])===null?null:b[field]-a[field];
    pairs.push({case:key,baseline:left,treatment:right,baselineSuccess:a.behavioralSuccess,treatmentSuccess:b.behavioralSuccess,inputTokensDifference:difference("inputTokens"),outputTokensDifference:difference("outputTokens"),durationMsDifference:difference("durationMs"),costDifference:difference("totalAttributableCost"),usageIncludesCompaction:a.usageIncludesCompaction===true&&b.usageIncludesCompaction===true?true:null});
  }
  const summary=Object.fromEntries(["A","B","C"].map(arm=>{const entries=[...groups.values()].flatMap(group=>group.has(arm)?[group.get(arm).record]:[]),successes=entries.filter(record=>record.behavioralSuccess===true).length,costs=entries.map(record=>finite(record.totalAttributableCost));return[arm,{eligibleRuns:entries.length,verifiedSuccesses:successes,verifiedSuccessRate:entries.length?successes/entries.length:null,costPerVerifiedSuccess:successes&&costs.every(cost=>cost!==null)?costs.reduce((a,b)=>a+b,0)/successes:null}];}));
  return{schemaVersion:"continuum.recovery-comparison.v1",records:records.length,exclusions,pairs,summary,decisionReady:false,qualification:"Development fixtures; no general performance conclusion. Provider cost, full compaction usage, requirement retention, and repetition remain separate gates."};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),outputIndex=args.indexOf("--output"),output=outputIndex>=0?args[outputIndex+1]:null;
  if(args.includes("--help")){console.log("Usage: node scripts/recovery-report.mjs <report.json|directory> ... [--output file.json]\nCompares real A/B/C cells, rejects mismatched configurations and duplicate cells, and excludes dry runs and mocks.");process.exit(0);}
  const inputs=args.filter((_,index)=>outputIndex<0||index!==outputIndex&&index!==outputIndex+1);if(!inputs.length)throw new Error("At least one report is required.");
  const reports=await Promise.all(inputs.map(async input=>JSON.parse(await readFile(input.endsWith(".json")?resolve(input):join(resolve(input),"report.json"),"utf8"))));
  const text=JSON.stringify(compareRecoveryReports(reports),null,2)+"\n";if(output)await writeFile(output,text);else console.log(text);
}
