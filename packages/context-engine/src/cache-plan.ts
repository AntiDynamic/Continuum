import { createHash } from "node:crypto";
import type {
  ContextCacheLayer,
  ContextCacheLayerManifest,
  ContextCachePlan,
  ContextCachePlanManifest,
  ContextCoverageReport,
  ContextPacketItem,
  ContextPacketOmission,
  ContextPacketSection,
  ContextProvenance,
  ContextItemVersion,
  IndexSnapshotIdentity,
  TaskAnalysis,
  TokenEstimator,
} from "@continuum/shared";
import { CONTEXT_CACHE_PLAN_SCHEMA_VERSION } from "@continuum/shared";

export const DEFAULT_STABLE_PREFIX_MAX_CHARACTERS = 900;

export interface CachePlanPacketInput {
  task: TaskAnalysis;
  orientation: ContextPacketSection;
  implementation: ContextPacketSection;
  omittedItems: ContextPacketOmission[];
  coverage: ContextCoverageReport;
}

function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function snapshotKey(snapshot: IndexSnapshotIdentity): string {
  return [snapshot.snapshot_kind, snapshot.base_commit_hash, snapshot.worktree_hash ?? "", snapshot.dirty ? "dirty" : "clean"].join("/");
}

function sortVersions(left: ContextItemVersion, right: ContextItemVersion): number {
  return left.source_path.localeCompare(right.source_path)
    || left.source_start_line - right.source_start_line
    || left.source_end_line - right.source_end_line
    || (left.symbol_name ?? "").localeCompare(right.symbol_name ?? "")
    || left.id.localeCompare(right.id);
}

function sortPacketItems(left: ContextPacketItem, right: ContextPacketItem): number {
  return sortVersions(left.candidate.item, right.candidate.item);
}

function provenanceFor(item: ContextPacketItem): ContextProvenance {
  return item.candidate.provenance;
}

function stableLine(version: ContextItemVersion): string {
  const symbol = version.symbol_name ? ` ${version.symbol_name}` : "";
  const title = version.title && version.title !== version.symbol_name ? ` (${version.title})` : "";
  return `- ${version.source_path}:${version.source_start_line}-${version.source_end_line}${symbol}${title}`;
}

function buildStablePrefix(
  repositoryId: number,
  snapshot: IndexSnapshotIdentity,
  strategyVersion: string,
  currentVersions: ContextItemVersion[],
  estimator: TokenEstimator,
  maxCharacters: number,
): ContextCacheLayer {
  const importance = (item:ContextItemVersion) => /(?:^|\/)(README|AGENTS|SECURITY)\.md$/i.test(item.source_path)?100:/\.(test|spec)\./.test(item.source_path)?40:item.metadata_json?.includes('"exported":true')?60:20;
  const ranked = [...currentVersions].sort((a,b)=>importance(b)-importance(a)||sortVersions(a,b));
  const seenPaths=new Set<string>();
  const first=ranked.filter(item=>{if(seenPaths.has(item.source_path))return false;seenPaths.add(item.source_path);return true;});
  const included=new Set(first.map(item=>item.id));
  const versions = [...first,...ranked.filter(item=>!included.has(item.id))];
  const header = [
    "CONTINUUM STABLE REPOSITORY PREFIX v1",
    `REPOSITORY: ${repositoryId}`,
    `SNAPSHOT: ${snapshotKey(snapshot)}`,
    `STRATEGY: ${strategyVersion}`,
    `INDEXED ITEMS: ${versions.length}`,
    "REPOSITORY MAP:",
  ];
  const lines = [...header];
  const itemIds: string[] = [];
  let characters = lines.join("\n").length;
  for (const version of versions) {
    const line = stableLine(version);
    if (characters + line.length + 1 > maxCharacters) break;
    lines.push(line);
    characters += line.length + 1;
    itemIds.push(version.id);
  }
  if (itemIds.length < versions.length) lines.push(`- ... ${versions.length - itemIds.length} indexed item(s) omitted from the bounded repository map`);
  const content = lines.join("\n");
  return {
    role: "stable_prefix",
    repositoryId,
    strategyVersion,
    snapshot,
    contentHash: hash(content),
    estimatedTokens: estimator.estimate(content),
    itemIds,
    content,
  };
}

function itemBlock(item: ContextPacketItem, section: string): string {
  const version = item.candidate.item;
  const provenance = provenanceFor(item);
  const coverage = [...item.candidate.coverageCategories].sort().join(", ") || "none";
  const symbol = version.symbol_name ? `\nSYMBOL: ${version.symbol_name}` : "";
  return [
    `SECTION: ${section}`,
    `PATH: ${version.source_path}`,
    `LINES: ${version.source_start_line}-${version.source_end_line}`,
    `ITEM ID: ${version.id}`,
    `CONTENT HASH: ${version.content_hash}`,
    `PROVENANCE: ${provenance.sourcePath}:${provenance.sourceStartLine}-${provenance.sourceEndLine} via ${provenance.extractor}`,
    `COVERAGE: ${coverage}${symbol}`,
    item.content,
  ].join("\n");
}

function buildTaskDelta(
  repositoryId: number,
  snapshot: IndexSnapshotIdentity,
  strategyVersion: string,
  packet: CachePlanPacketInput,
  estimator: TokenEstimator,
): ContextCacheLayer {
  const selected = new Map<string, { section: string; item: ContextPacketItem }>();
  for (const [section, packetSection] of [["ORIENTATION", packet.orientation], ["IMPLEMENTATION", packet.implementation]] as const) {
    for (const item of packetSection.items) if (!selected.has(item.candidate.item.id)) selected.set(item.candidate.item.id, { section, item });
  }
  const items = [...selected.values()].sort((left, right) => sortPacketItems(left.item, right.item));
  const required = packet.coverage.requirements.filter((entry) => entry.required).map((entry) => entry.category).sort();
  const covered = [...packet.coverage.covered].sort();
  const missing = [...packet.coverage.missing].sort();
  const omissions = [...packet.omittedItems].sort((left, right) => left.contextItemVersionId.localeCompare(right.contextItemVersionId));
  const blocks = items.map(({ section, item }) => itemBlock(item, section));
  const omissionLines = omissions.length
    ? ["OMISSIONS:", ...omissions.map((item) => `- ${item.contextItemVersionId} ${item.title} [${item.reason}; ~${item.estimatedTokens} tokens]`)]
    : ["OMISSIONS: none"];
  const content = [
    "CONTINUUM TASK DELTA v1",
    `REPOSITORY: ${repositoryId}`,
    `SNAPSHOT: ${snapshotKey(snapshot)}`,
    `STRATEGY: ${strategyVersion}`,
    `TASK CLASS: ${packet.task.taskClass}`,
    `RISK: ${packet.task.riskLevel}`,
    `TASK: ${packet.task.originalTask}`,
    `REQUIRED COVERAGE: ${required.join(", ") || "none"}`,
    `COVERED COVERAGE: ${covered.join(", ") || "none"}`,
    `REMAINING COVERAGE: ${missing.join(", ") || "none"}`,
    "CONTEXT ITEMS:",
    blocks.length ? blocks.join("\n\n---\n\n") : "No selected indexed context.",
    ...omissionLines,
  ].join("\n");
  return {
    role: "task_delta",
    repositoryId,
    strategyVersion,
    snapshot,
    contentHash: hash(content),
    estimatedTokens: estimator.estimate(content),
    itemIds: items.map(({ item }) => item.candidate.item.id),
    content,
  };
}

export function buildContextCachePlan(
  repositoryId: number,
  snapshot: IndexSnapshotIdentity,
  strategyVersion: string,
  packet: CachePlanPacketInput,
  currentVersions: ContextItemVersion[],
  estimator: TokenEstimator,
  options: { maxStablePrefixCharacters?: number } = {},
): ContextCachePlan {
  const stablePrefix = buildStablePrefix(repositoryId, snapshot, strategyVersion, currentVersions, estimator, options.maxStablePrefixCharacters ?? DEFAULT_STABLE_PREFIX_MAX_CHARACTERS);
  const taskDelta = buildTaskDelta(repositoryId, snapshot, strategyVersion, packet, estimator);
  return { schemaVersion: CONTEXT_CACHE_PLAN_SCHEMA_VERSION, repositoryId, strategyVersion, snapshot, stablePrefix, taskDelta };
}

export function cacheLayerManifest(layer: ContextCacheLayer): ContextCacheLayerManifest {
  const { content: _content, ...manifest } = layer;
  return manifest;
}

export function cachePlanManifest(plan: ContextCachePlan): ContextCachePlanManifest {
  return { schemaVersion: plan.schemaVersion, repositoryId: plan.repositoryId, strategyVersion: plan.strategyVersion, snapshot: plan.snapshot, stablePrefix: cacheLayerManifest(plan.stablePrefix), taskDelta: cacheLayerManifest(plan.taskDelta) };
}
