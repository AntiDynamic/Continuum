import type { RepositoryContextSessionService } from "@continuum/context-engine";
import { resolveSnapshotIdentity } from "@continuum/git-analyzer";
import { isRecord } from "./json.js";

export async function observeContextActivity(service: RepositoryContextSessionService, sessionId: string, method: string, params: unknown,executionId="unknown"): Promise<void> {
  if (method !== "item/completed" || !isRecord(params) || !isRecord(params.item)) return;
  const item = params.item;
  if (item.type === "fileChange" && Array.isArray(item.changes)) {
    await service.observe(sessionId,{changedPaths:item.changes.flatMap(change=>isRecord(change)&&typeof change["path"]==="string"?[change["path"]]:[])});
    service.memory.write(sessionId,{kind:"source",text:"Observed file changes: "+item.changes.flatMap(change=>isRecord(change)&&typeof change["path"]==="string"?[change["path"]]:[]).join(", "),authority:"observed",snapshot:await resolveSnapshotIdentity(service.repositoryRoot),operationKey:"host-file:"+executionId+":"+String(params["turnId"])+":"+String(item.id),metadata:{executionId,turnId:params["turnId"],itemId:item.id,sourceMethod:method}});
  } else if (item.type === "commandExecution" && typeof item.command === "string" && typeof item.exitCode === "number" && /\b(test|pytest|vitest|jest)\b/.test(item.command)) {
    await service.observe(sessionId,{validation:{command:item.command,exitCode:item.exitCode}});
    service.memory.write(sessionId,{kind:"validation",text:`Observed test command ${item.command} exited ${item.exitCode}. This is command execution evidence, not independent behavioral qualification.`,authority:"observed",snapshot:await resolveSnapshotIdentity(service.repositoryRoot),operationKey:"host-test:"+executionId+":"+String(params["turnId"])+":"+String(item.id),metadata:{command:item.command,exitCode:item.exitCode,executionId,turnId:params["turnId"],itemId:item.id,sourceMethod:method,snapshotTiming:"notification_observed"}});
  }
}
