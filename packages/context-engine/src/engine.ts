import { ContextRepository, type Db } from "@continuum/database";
import {
  CharacterRatioTokenEstimator,
  type CompiledContextPacket,
  type ContextCandidate,
  type ContextCoverageCategory,
  type ContextCoverageReport,
  type ContextItemVersion,
  type ContextPacketBudget,
  type ContextPacketItem,
  type ContextPacketOmission,
  type ContextProvenance,
  type IndexSnapshotIdentity,
  type RetrievalScoreComponents,
  type SemanticRetriever,
  type TaskAnalysis,
  type TokenEstimator,
} from "@continuum/shared";
import { DisabledSemanticRetriever, normalizeFtsBm25 } from "./semantic.js";
import { DeterministicTaskAnalyzer } from "./task-analyzer.js";

export const CONTEXT_COMPILER_STRATEGY = "context-compiler-v1";
export const DEFAULT_PACKET_BUDGET: ContextPacketBudget = { maxEstimatedTokens: 8000, maxItems: 25, maxEstimatedTokensPerItem: 1800, orientationReserveRatio: 0.15, requiredCoverageReserveRatio: 0.35 };

function emptyComponents(): RetrievalScoreComponents {
  return { exactSymbol: 0, exactTitle: 0, exactPath: 0, lexical: 0, contextualHeader: 0, dependencyRelation: 0, testRelation: 0, architectureRelation: 0, configurationRelation: 0, priorEpisodeRelation: 0, taskClassRelevance: 0, riskCoverage: 0, currentSnapshot: 0, uncommittedPenalty: 0, stalenessPenalty: 0, historicalPenalty: 0, tokenCostPenalty: 0, duplicatePenalty: 0 };
}

function metadata(version: ContextItemVersion): Record<string, unknown> {
  try { return version.metadata_json ? JSON.parse(version.metadata_json) as Record<string, unknown> : {}; } catch { return {}; }
}

function provenance(version: ContextItemVersion, repositoryId: number): ContextProvenance {
  try { if (version.provenance_json) return JSON.parse(version.provenance_json) as ContextProvenance; } catch { /* use explicit fallback */ }
  return { repositoryId, sourcePath: version.source_path, sourceStartLine: version.source_start_line, sourceEndLine: version.source_end_line, extractor: "legacy-indexer", snapshot: { snapshot_kind: version.staleness_status === "uncommitted" ? "worktree" : "commit", base_commit_hash: version.valid_from_commit, worktree_hash: null, dirty: version.staleness_status === "uncommitted" }, confidence: "medium" };
}

function categories(version: ContextItemVersion): ContextCoverageCategory[] {
  const result = new Set<ContextCoverageCategory>();
  const path = version.source_path.toLowerCase();
  const kind = version.metadata_json ? metadata(version)["constraintKind"] : undefined;
  if (version.symbol_name || /function|class|method|type|interface/.test(version.language)) result.add("implementation");
  if (["interface", "type", "export"].includes((metadata(version)["declarationKind"] as string | undefined) ?? "")) result.add("public_contract");
  if (/test|spec/.test(path) || version.title?.toLowerCase().includes("test")) result.add("tests");
  if (/package\.json|\.ya?ml$|config/.test(path)) result.add("configuration");
  if (/readme|architecture|agents\.md/.test(path)) result.add("architecture");
  if (kind === "security" || kind === "privacy") result.add("security_constraint");
  if (/migration|schema/.test(path) || ["table", "index", "view", "migration"].includes(version.language)) result.add("database_schema");
  if (/rollback|down migration/i.test(version.content)) result.add("rollback");
  if (/package\.json|lock/.test(path)) result.add("dependency");
  if (/\.md$/.test(path)) result.add("documentation");
  return [...result];
}

function sumComponents(components: RetrievalScoreComponents): number {
  return Object.values(components).reduce((sum, value) => sum + value, 0);
}

export interface ContextSearchOptions { limit?: number; includeStale?: boolean; includeHistorical?: boolean }

export class ContextEngine {
  private readonly repository: ContextRepository;
  private readonly analyzer = new DeterministicTaskAnalyzer();
  constructor(
    private readonly db: Db,
    private readonly repositoryId: number,
    private readonly snapshot: IndexSnapshotIdentity,
    private readonly estimator: TokenEstimator = new CharacterRatioTokenEstimator(),
    private readonly semantic: SemanticRetriever = new DisabledSemanticRetriever(),
  ) { this.repository = new ContextRepository(db); }

  analyze(task: string): TaskAnalysis { return this.analyzer.analyze(task); }

  async search(task: string, options: ContextSearchOptions = {}): Promise<ContextCandidate[]> {
    const analysis = this.analyze(task);
    const limit = options.limit ?? 50;
    const lexical = this.repository.searchContextItems(task, Math.max(limit * 3, 100), this.repositoryId);
    const exactPool = this.repository.listCurrentVersions(this.repositoryId, 500);
    const byId = new Map<string, { version: ContextItemVersion; score: number; rawScore?: number; backend?: "fts5" | "fallback_lexical" }>();
    for (const result of lexical) byId.set(result.version.id, result);
    for (const version of exactPool) {
      const path = version.source_path.toLowerCase();
      const symbol = version.symbol_name?.toLowerCase() ?? "";
      const exact = analysis.mentionedPaths.some((value) => path.endsWith(value.toLowerCase())) || analysis.mentionedSymbols.some((value) => symbol === value.toLowerCase()) || analysis.mentionedPackages.some((value) => path.includes(value.replace(/^@continuum\//, "").toLowerCase()));
      if (exact && !byId.has(version.id)) byId.set(version.id, { version, score: 0, rawScore: 0, backend: "fallback_lexical" });
    }
    const coverageCompleted = new Set<string>();
    const seededCoverage = new Set([...byId.values()].flatMap((result) => categories(result.version)));
    for (const requirement of analysis.requiredCoverage.filter((item) => item.required && !seededCoverage.has(item.category))) {
      const matches = exactPool.filter((version) => {
        if (!categories(version).includes(requirement.category)) return false;
        const searchable = `${version.title ?? ""} ${version.symbol_name ?? ""} ${version.source_path} ${version.contextual_header ?? ""} ${version.content}`.toLowerCase();
        return analysis.keywords.some((keyword) => searchable.includes(keyword));
      }).slice(0, requirement.maximumItems ?? 3);
      for (const version of matches) {
        if (!byId.has(version.id)) byId.set(version.id, { version, score: 0, rawScore: 0, backend: "fallback_lexical" });
        coverageCompleted.add(version.id);
      }
    }
    const candidates: ContextCandidate[] = [];
    const graphExpanded = new Set<string>();
    for (const seed of [...byId.values()].slice(0, 10)) {
      for (const related of this.repository.listRelatedVersions(seed.version.context_item_id, 5)) {
        graphExpanded.add(related.id);
        if (byId.has(related.id)) continue;
        byId.set(related.id, { version: related, score: 0, rawScore: 0, backend: "fallback_lexical" });
      }
    }
    const seenHashes = new Set<string>();
    for (const result of byId.values()) {
      const version = result.version;
      if (!options.includeHistorical && version.valid_to_commit_exclusive !== null) continue;
      if (!options.includeStale && version.staleness_status === "stale") continue;
      const components = emptyComponents();
      const reasons: string[] = [];
      const lowerTask = task.toLowerCase();
      const symbol = version.symbol_name?.toLowerCase() ?? "";
      const title = version.title?.toLowerCase() ?? "";
      const path = version.source_path.toLowerCase();
      const explicitSymbol = symbol.length >= 3 && (analysis.keywords.includes(symbol) || analysis.mentionedSymbols.some((value) => value.toLowerCase() === symbol));
      if (explicitSymbol) { components.exactSymbol = 4; reasons.push(`Exact symbol match: ${version.symbol_name}`); }
      if (title.length >= 4 && lowerTask.includes(title)) { components.exactTitle = 1.5; reasons.push(`Exact title match: ${version.title}`); }
      if (analysis.mentionedPaths.some((value) => path.endsWith(value.toLowerCase()))) { components.exactPath = 4; reasons.push(`Exact path match: ${version.source_path}`); }
      if (coverageCompleted.has(version.id)) {
        components.riskCoverage += 1;
        reasons.push("Added to complete a required task-coverage category.");
      }
      const rawScore = result.rawScore ?? -Math.max(0, result.score);
      const normalized = result.backend === "fallback_lexical" ? Math.max(0, Math.min(1, result.score)) : normalizeFtsBm25(rawScore);
      components.lexical = normalized * 2;
      if (normalized > 0) reasons.push(`Lexical relevance via ${result.backend ?? "fts5"}.`);
      if (graphExpanded.has(version.id)) {
        components.dependencyRelation = 1.25;
        reasons.push("Expanded through a high- or medium-confidence repository relationship.");
      }

      const header = version.contextual_header?.toLowerCase() ?? "";
      const headerHits = analysis.keywords.filter((keyword) => header.includes(keyword)).length;
      components.contextualHeader = Math.min(1, headerHits / Math.max(1, analysis.keywords.length));
      let coverage = categories(version);
      const testSignals = analysis.keywords.filter((keyword) => keyword.length >= 4 && `${title} ${path} ${version.content.toLowerCase()}`.includes(keyword)).length;
      const testRelevant = !coverage.includes("tests") || graphExpanded.has(version.id) || testSignals >= 2;
      if (!testRelevant) coverage = coverage.filter((category) => category !== "tests");
      const required = new Set(analysis.requiredCoverage.filter((item) => item.required).map((item) => item.category));
      const requiredHits = coverage.filter((category) => required.has(category));
      components.riskCoverage = requiredHits.length * 0.75 + (coverageCompleted.has(version.id) ? 1 : 0);
      if (requiredHits.length) reasons.push(`Required coverage: ${requiredHits.join(", ")}`);
      if (coverage.includes("tests")) { components.testRelation = analysis.taskClass === "local_bug" || analysis.taskClass === "test_repair" || analysis.taskClass === "refactor" ? 2 : 0.5; reasons.push("Task-related or relationship-verified test candidate."); }
      if (coverage.includes("architecture")) components.architectureRelation = 0.5;
      if (coverage.includes("configuration")) components.configurationRelation = 0.5;
      components.taskClassRelevance = coverage.some((category) => required.has(category)) ? 0.75 : 0;
      const declarationKind = String(metadata(version)["declarationKind"] ?? "");
      if (coverage.includes("implementation") && !["import", "constant", "variable"].includes(declarationKind)) components.taskClassRelevance += 0.5;
      if (analysis.keywords.some((keyword) => keyword.length >= 4 && path.includes(keyword))) { components.dependencyRelation += 0.75; reasons.push("Source path matches a task keyword."); }
      components.currentSnapshot = version.staleness_status === "current" ? 1 : 0;
      components.uncommittedPenalty = version.staleness_status === "uncommitted" ? -0.25 : 0;
      components.stalenessPenalty = version.staleness_status === "possibly_stale" || version.staleness_status === "stale" ? -2 : 0;
      components.historicalPenalty = version.valid_to_commit_exclusive ? -3 : 0;
      const estimatedTokens = this.estimator.estimate(version.compiled_content ?? version.content);
      components.tokenCostPenalty = -Math.min(1.5, estimatedTokens / 1800);
      if (seenHashes.has(version.content_hash)) { components.duplicatePenalty = -5; reasons.push("Duplicate compiled content penalized."); } else seenHashes.add(version.content_hash);
      reasons.push(`Estimated cost: ${estimatedTokens} tokens (${this.estimator.id}).`);
      candidates.push({ item: version, score: sumComponents(components), components, reasons, coverageCategories: coverage, estimatedTokens, provenance: provenance(version, this.repositoryId), lexicalEvidence: { backend: result.backend ?? "fts5", rawScore, normalizedScore: normalized, normalizationMethod: result.backend === "fallback_lexical" ? "weighted deterministic overlap" : "max(0,-raw)/(1+max(0,-raw))" } });
    }
    candidates.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
    return candidates.slice(0, limit);
  }

  coverageFor(analysis: TaskAnalysis, items: ContextCandidate[]): ContextCoverageReport {
    const evidence = analysis.requiredCoverage.map((requirement) => {
      const ids = items.filter((item) => item.coverageCategories.includes(requirement.category)).map((item) => item.item.id);
      return { category: requirement.category, contextItemVersionIds: ids, explanation: ids.length ? `${ids.length} selected item(s) cover ${requirement.category}.` : `No verified ${requirement.category} context selected.` };
    });
    const covered = evidence.filter((item) => item.contextItemVersionIds.length).map((item) => item.category);
    const missing = analysis.requiredCoverage.filter((item) => item.required && !covered.includes(item.category)).map((item) => item.category);
    return { requirements: analysis.requiredCoverage, covered, missing, coverageEvidence: evidence, complete: missing.length === 0 };
  }

  async packet(task: string, budget: ContextPacketBudget = DEFAULT_PACKET_BUDGET): Promise<CompiledContextPacket> {
    const analysis = this.analyze(task);
    const candidates = await this.search(task, { limit: Math.max(100, budget.maxItems * 4) });
    const selected: ContextPacketItem[] = [];
    const omissions: ContextPacketOmission[] = [];
    const fileCounts = new Map<string, number>();
    const hashes = new Set<string>();
    let total = 0;
    const requiredCategories = analysis.requiredCoverage.filter((item) => item.required).map((item) => item.category);
    const ordered = [...candidates].sort((a, b) => Number(requiredCategories.some((category) => b.coverageCategories.includes(category))) - Number(requiredCategories.some((category) => a.coverageCategories.includes(category))) || b.score - a.score);
    for (const candidate of ordered) {
      const title = candidate.item.title ?? candidate.item.symbol_name ?? candidate.item.source_path;
      if (hashes.has(candidate.item.content_hash)) { omissions.push({ contextItemVersionId: candidate.item.id, title, reason: "duplicate", estimatedTokens: candidate.estimatedTokens }); continue; }
      if ((fileCounts.get(candidate.item.source_path) ?? 0) >= 3) { omissions.push({ contextItemVersionId: candidate.item.id, title, reason: "diversity", estimatedTokens: candidate.estimatedTokens }); continue; }
      if (candidate.estimatedTokens > budget.maxEstimatedTokensPerItem) { omissions.push({ contextItemVersionId: candidate.item.id, title, reason: "oversized", estimatedTokens: candidate.estimatedTokens }); continue; }
      if (selected.length >= budget.maxItems || total + candidate.estimatedTokens > budget.maxEstimatedTokens) { omissions.push({ contextItemVersionId: candidate.item.id, title, reason: "budget", estimatedTokens: candidate.estimatedTokens }); continue; }
      const content = candidate.item.compiled_content ?? candidate.item.content;
      selected.push({ candidate, content, truncated: false }); total += candidate.estimatedTokens; hashes.add(candidate.item.content_hash); fileCounts.set(candidate.item.source_path, (fileCounts.get(candidate.item.source_path) ?? 0) + 1);
    }
    const orientationItems = selected.filter((item) => item.candidate.coverageCategories.some((category) => ["architecture", "repository_state", "security_constraint"].includes(category))).slice(0, 4);
    const orientationIds = new Set(orientationItems.map((item) => item.candidate.item.id));
    const implementationItems = selected.filter((item) => !orientationIds.has(item.candidate.item.id));
    const selectedIds = new Set(selected.map((item) => item.candidate.item.id));
    const escalation = candidates.filter((item) => !selectedIds.has(item.item.id)).slice(0, 10).map((candidate) => ({ candidate, content: "", truncated: false }));
    const coverage = this.coverageFor(analysis, selected.map((item) => item.candidate));
    if (!coverage.complete) coverage.additionalEstimatedBudgetRequired = coverage.missing.reduce((sum, category) => sum + (candidates.find((candidate) => candidate.coverageCategories.includes(category))?.estimatedTokens ?? budget.maxEstimatedTokensPerItem), 0);
    const sectionTokens = (items: ContextPacketItem[]) => items.reduce((sum, item) => sum + item.candidate.estimatedTokens, 0);
    const packet: CompiledContextPacket = { id: crypto.randomUUID(), repositoryId: this.repositoryId, snapshot: this.snapshot, task: analysis, budget, orientation: { items: orientationItems, estimatedTokens: sectionTokens(orientationItems) }, implementation: { items: implementationItems, estimatedTokens: sectionTokens(implementationItems) }, escalationCandidates: { items: escalation, estimatedTokens: 0 }, coverage, totalEstimatedTokens: total, omittedItems: omissions, complete: coverage.complete, incompleteReasons: coverage.missing.map((category) => `Missing required category: ${category}`), strategyVersion: CONTEXT_COMPILER_STRATEGY, generatedAt: new Date().toISOString() };
    this.repository.recordCompilerRetrieval({ id: crypto.randomUUID(), query: task, strategy: CONTEXT_COMPILER_STRATEGY, taskAnalysisJson: JSON.stringify(analysis), packetJson: JSON.stringify(packet), candidates, includedVersionIds: [...selectedIds] });
    return packet;
  }

  explain(itemId: string): ContextItemVersion | undefined { return this.repository.findVersionById(this.repositoryId, itemId); }
}
