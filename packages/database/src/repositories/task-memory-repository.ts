import { randomUUID } from "node:crypto";
import type { Db } from "../connection.js";
import type { DurableRecoveryPacket, MemoryWrite, TaskEvidence, TaskMemoryEntry, TaskMemoryState } from "@continuum/shared";

interface EntryRow { id:string;session_id:string;version:number;kind:TaskMemoryEntry["kind"];text:string;authority:TaskMemoryEntry["authority"];critical:number;evidence_id:string;supersedes:string|null;superseded_by:string|null }
const entry=(row:EntryRow):TaskMemoryEntry=>({id:row.id,sessionId:row.session_id,version:row.version,kind:row.kind,text:row.text,authority:row.authority,critical:row.critical===1,evidenceId:row.evidence_id,supersedes:row.supersedes,supersededBy:row.superseded_by});

/** Writes evidence and its memory assertion atomically. Originals are never rewritten. */
export class TaskMemoryRepository {
  constructor(private readonly db:Db) {}
  state(sessionId:string):TaskMemoryState {
    const rows=this.db.prepare(`SELECT m.*,s.id superseded_by FROM task_memory m LEFT JOIN task_memory s ON s.supersedes=m.id WHERE m.session_id=? ORDER BY m.version`).all(sessionId) as unknown as EntryRow[];
    const evidenceIds=new Set(rows.map(row=>row.evidence_id));
    const evidence=(this.db.prepare("SELECT * FROM task_evidence WHERE session_id=? ORDER BY rowid").all(sessionId) as Array<Record<string,unknown>>).filter(row=>evidenceIds.has(String(row["id"])));
    return {sessionId,version:rows.at(-1)?.version??0,entries:rows.map(entry),evidence:evidence.map(row=>({id:String(row["id"]),sessionId:String(row["session_id"]),text:String(row["text"]),authority:row["authority"] as TaskEvidence["authority"],snapshot:row["snapshot_json"]?JSON.parse(String(row["snapshot_json"])):null,sourceVersionId:row["source_version_id"] as string|null,metadata:JSON.parse(String(row["metadata_json"])),createdAt:String(row["created_at"])}))};
  }
  append(sessionId:string,input:MemoryWrite):TaskMemoryEntry {
    if(!input.text.trim()||input.text.length>128000)throw new Error("Memory text must contain 1–128000 characters.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if(input.operationKey){const existing=this.db.prepare("SELECT id FROM task_memory WHERE session_id=? AND operation_key=?").get(sessionId,input.operationKey) as {id:string}|undefined;if(existing){const found=this.state(sessionId).entries.find(item=>item.id===existing.id)!;if(found.text!==input.text||found.kind!==input.kind||found.authority!==input.authority||found.critical!==!!input.critical||found.supersedes!==(input.supersedes??null))throw new Error("Operation key reused with different memory.");this.db.exec("COMMIT");return found;}}
      if(input.supersedes){const old=this.state(sessionId).entries.find(item=>item.id===input.supersedes);if(!old||old.supersededBy||old.kind!==input.kind)throw new Error("Supersession requires an active entry of the same kind in this session.");if(old.authority==="user"&&input.authority!=="user")throw new Error("Agent memory cannot supersede a user requirement.");}
      if(input.sourceVersionId){const valid=this.db.prepare(`SELECT 1 FROM context_item_versions v JOIN context_items i ON i.id=v.context_item_id JOIN context_sessions s ON s.repository_id=i.repository_id WHERE v.id=? AND s.id=?`).get(input.sourceVersionId,sessionId);if(!valid)throw new Error("Source evidence not found in this repository.");}
      const state=this.state(sessionId),id=randomUUID(),evidenceId=randomUUID();
      this.db.prepare("INSERT INTO task_evidence VALUES(?,?,?,?,?,?,?,?)").run(evidenceId,sessionId,input.text,input.authority,input.snapshot?JSON.stringify(input.snapshot):null,input.sourceVersionId??null,JSON.stringify(input.metadata??{}),new Date().toISOString());
      this.db.prepare("INSERT INTO task_memory VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,sessionId,state.version+1,input.kind,input.text,input.authority,input.critical?1:0,evidenceId,input.supersedes??null,input.operationKey??null);
      const result=this.state(sessionId).entries.find(item=>item.id===id)!;this.db.exec("COMMIT");return result;
    } catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  checkpoint(sessionId:string,boundaryKey:string,packet:DurableRecoveryPacket):{id:string;packet:DurableRecoveryPacket} {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing=this.db.prepare("SELECT id,recovery_json FROM task_checkpoints WHERE session_id=? AND boundary_key=?").get(sessionId,boundaryKey) as {id:string;recovery_json:string}|undefined;
      if(existing){this.db.exec("COMMIT");return{id:existing.id,packet:JSON.parse(existing.recovery_json)};}
      const state=this.state(sessionId);
      if(state.version!==packet.memoryVersion)throw new Error("Task memory changed while preparing checkpoint; retry.");
      const projection={sessionId,version:state.version,activeEntries:state.entries.filter(item=>!item.supersededBy).map(item=>({id:item.id,kind:item.kind,authority:item.authority,critical:item.critical,evidenceId:item.evidenceId}))};
      const id=randomUUID();this.db.prepare("INSERT INTO task_checkpoints VALUES(?,?,?,?,?,?,?,?,?)").run(id,sessionId,boundaryKey,state.version,JSON.stringify(packet.snapshot),JSON.stringify(projection),JSON.stringify(packet),"pending",new Date().toISOString());
      this.db.prepare("UPDATE codex_session_bindings SET recovery_pending=1,last_checkpoint_id=? WHERE session_id=?").run(id,sessionId);
      this.db.exec("COMMIT");return{id,packet};
    } catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  evidence(sessionId:string,evidenceId:string):TaskEvidence|null{return this.state(sessionId).evidence.find(item=>item.id===evidenceId)??null;}
}
