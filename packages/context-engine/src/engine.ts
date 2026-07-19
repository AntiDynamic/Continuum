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
import { normalizeRetrievalTerms, splitIdentifierTerms, RETRIEVAL_NORMALIZATION_VERSION } from "./normalization.js";

export const CONTEXT_COMPILER_STRATEGY = "context-compiler-v2-budgeted";
export const DEFAULT_PACKET_BUDGET: ContextPacketBudget = { maxEstimatedTokens: 1900, maxItems: 12, maxEstimatedTokensPerItem: 1800, orientationReserveRatio: 0.13, requiredCoverageReserveRatio: 0.37, orientationCeiling: 250, exactImplementationCeiling: 700, mandatoryContextReserve: 350, directTestReserve: 350, optionalContextCeiling: 250 };

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

export interface RetrievalStageProfile { taskAnalysis: number; queryNormalization: number; exactLookup: number; lexicalFtsLookup: number; candidateSeeding: number; relationshipExpansion: number; coverageClassification: number; databaseHydration: number; ranking: number; diversitySelection: number; tokenEstimation: number; packetAssembly: number }
export type MutableRetrievalStageProfile = Partial<RetrievalStageProfile>;
export interface ContextSearchOptions { limit?: number; includeStale?: boolean; includeHistorical?: boolean; profile?: MutableRetrievalStageProfile }
const elapsed = (started: number) => performance.now() - started;
const addTiming = (profile: MutableRetrievalStageProfile | undefined, key: keyof RetrievalStageProfile, value: number): void => { if (profile) profile[key] = (profile[key] ?? 0) + value; };

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
    let stageStarted = performance.now();
    const analysis = this.analyze(task);
    addTiming(options.profile, "taskAnalysis", elapsed(stageStarted));
    const limit = options.limit ?? 50;
    stageStarted = performance.now();
    const normalizedQuery = normalizeRetrievalTerms(task).slice(0, 12).join(" ");
    addTiming(options.profile, "queryNormalization", elapsed(stageStarted));
    stageStarted = performance.now();
    const lexical = this.repository.searchContextItems(normalizedQuery, Math.min(100, Math.max(limit, 60)), this.repositoryId);
    const lexicalMs = elapsed(stageStarted);
    addTiming(options.profile, "lexicalFtsLookup", lexicalMs);
    stageStarted = performance.now();
    const exactHints = [...analysis.mentionedPaths, ...analysis.mentionedSymbols, ...analysis.keywords];
    const exactPool = this.repository.findCurrentVersionsByTerms(this.repositoryId, exactHints, Math.min(80, limit));
    const exactMs = elapsed(stageStarted);
    addTiming(options.profile, "exactLookup", exactMs);
    addTiming(options.profile, "databaseHydration", lexicalMs + exactMs);
    stageStarted = performance.now();
    const byId = new Map<string, { version: ContextItemVersion; score: number; rawScore?: number; backend?: "fts5" | "fallback_lexical" }>();
    for (const result of lexical) byId.set(result.version.id, result);
    for (const version of exactPool) {
      if (!byId.has(version.id)) byId.set(version.id, { version, score: 0.15, rawScore: 0.15, backend: "fallback_lexical" });
    }
    for (const version of exactPool) {
      const path = version.source_path.toLowerCase();
      const symbol = version.symbol_name?.toLowerCase() ?? "";
      const symbolTerms = normalizeRetrievalTerms(version.symbol_name ?? "");
      const exact = analysis.mentionedPaths.some((value) => path.endsWith(value.toLowerCase())) || analysis.mentionedSymbols.some((value) => symbol === value.toLowerCase()) || analysis.keywords.some((value) => symbolTerms.includes(value)) || analysis.mentionedPackages.some((value) => path.includes(value.replace(/^@continuum\//, "").toLowerCase()));
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
    addTiming(options.profile, "candidateSeeding", elapsed(stageStarted));
    const candidates: ContextCandidate[] = [];
    const graphExpanded = new Set<string>();
    stageStarted = performance.now();
    for (const seed of [...byId.values()].slice(0, 6)) {
      for (const related of this.repository.listRelatedVersions(seed.version.context_item_id, 3)) {
        graphExpanded.add(related.id);
        if (byId.has(related.id)) continue;
        byId.set(related.id, { version: related, score: 0, rawScore: 0, backend: "fallback_lexical" });
      }
    }
    const relationshipMs = elapsed(stageStarted);
    addTiming(options.profile, "relationshipExpansion", relationshipMs);
    addTiming(options.profile, "databaseHydration", relationshipMs);
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
      const symbolTerms = normalizeRetrievalTerms(version.symbol_name ?? "");
      const identifierParts = splitIdentifierTerms(version.symbol_name ?? "");
      const joinedIdentifierMatch = identifierParts.some((part, index) => index < identifierParts.length - 1 && analysis.keywords.includes(part + identifierParts[index + 1]!));
      const testPath = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(path);
      const testTask = analysis.taskClass === "test_repair" || analysis.taskClass === "local_bug";
      const explicitSymbol = symbol.length >= 3 && (!testPath || testTask) && (analysis.keywords.includes(symbol) || analysis.mentionedSymbols.some((value) => value.toLowerCase() === symbol) || joinedIdentifierMatch);
      if (explicitSymbol) { components.exactSymbol = 8; reasons.push(`Exact normalized symbol match: ${version.symbol_name}`); }
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
      stageStarted = performance.now();
      let coverage = categories(version);
      const testSignals = analysis.keywords.filter((keyword) => keyword.length >= 4 && `${title} ${path} ${version.content.toLowerCase()}`.includes(keyword)).length;
      const testRelevant = !coverage.includes("tests") || graphExpanded.has(version.id) || testSignals >= 1;
      if (!testRelevant) coverage = coverage.filter((category) => category !== "tests");
      addTiming(options.profile, "coverageClassification", elapsed(stageStarted));
      const required = new Set(analysis.requiredCoverage.filter((item) => item.required).map((item) => item.category));
      const requiredHits = coverage.filter((category) => required.has(category));
      components.riskCoverage = requiredHits.length * 0.75 + (coverageCompleted.has(version.id) ? 1 : 0);
      if (requiredHits.length) reasons.push(`Required coverage: ${requiredHits.join(", ")}`);
      if (coverage.includes("tests")) { components.testRelation = analysis.taskClass === "local_bug" || analysis.taskClass === "test_repair" || analysis.taskClass === "refactor" ? 2 : 1.25; reasons.push("Task-related or relationship-verified test candidate."); }
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
      stageStarted = performance.now();
      const estimatedTokens = this.estimator.estimate(version.compiled_content ?? version.content);
      addTiming(options.profile, "tokenEstimation", elapsed(stageStarted));
      components.tokenCostPenalty = -Math.min(1.5, estimatedTokens / 1800);
      if (seenHashes.has(version.content_hash)) { components.duplicatePenalty = -5; reasons.push("Duplicate compiled content penalized."); } else seenHashes.add(version.content_hash);
      reasons.push(`Estimated cost: ${estimatedTokens} tokens (${this.estimator.id}).`);
      reasons.push(`Query normalization: ${RETRIEVAL_NORMALIZATION_VERSION}.`);
      candidates.push({ item: version, score: sumComponents(components), components, reasons, coverageCategories: coverage, estimatedTokens, provenance: provenance(version, this.repositoryId), lexicalEvidence: { backend: result.backend ?? "fts5", rawScore, normalizedScore: normalized, normalizationMethod: result.backend === "fallback_lexical" ? "weighted deterministic overlap" : "max(0,-raw)/(1+max(0,-raw))" } });
    }
    stageStarted = performance.now();
    candidates.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
    addTiming(options.profile, "ranking", elapsed(stageStarted));
    return candidates.slice(0, limit);
  }

  coverageFor(analysis: TaskAnalysis, items: ContextCandidate[], availableCandidates: ContextCandidate[] = items): ContextCoverageReport {
    const evidence = analysis.requiredCoverage.map((requirement) => {
      const matches = availableCandidates.filter((item) => item.coverageCategories.includes(requirement.category));
      const ids = items.filter((item) => item.coverageCategories.includes(requirement.category)).map((item) => item.item.id);
      const state = matches.length === 0 ? "unavailable" : requirement.state;
      const remainingRequirement = state === "required" && ids.length === 0;
      const additionalEstimatedBudgetRequired = remainingRequirement ? Math.min(...matches.map((item) => item.estimatedTokens)) : 0;
      return { category: requirement.category, state, reason: matches.length === 0 ? `No indexed ${requirement.category} candidate applies to this task.` : requirement.reason, matchingIndexedCandidateCount: matches.length, contextItemVersionIds: ids, remainingRequirement, additionalEstimatedBudgetRequired, explanation: ids.length ? `${ids.length} selected item(s) cover ${requirement.category}.` : state === "unavailable" ? `No indexed ${requirement.category} evidence is available.` : `No verified ${requirement.category} context selected.` };
    });
    const covered = evidence.filter((item) => item.contextItemVersionIds.length).map((item) => item.category);
    const missing = evidence.filter((item) => item.remainingRequirement).map((item) => item.category);
    const additional = evidence.reduce((sum, item) => sum + item.additionalEstimatedBudgetRequired, 0);
    return { requirements: analysis.requiredCoverage, covered, missing, coverageEvidence: evidence, complete: missing.length === 0, ...(additional > 0 ? { additionalEstimatedBudgetRequired: additional } : {}) };
  }

  async packet(task: string, budget: ContextPacketBudget = DEFAULT_PACKET_BUDGET, profile: MutableRetrievalStageProfile = {}): Promise<CompiledContextPacket> {
    let stageStarted = performance.now();
    const analysis = this.analyze(task);
    addTiming(profile, "taskAnalysis", elapsed(stageStarted));
    const candidates = await this.search(task, { limit: Math.max(100, budget.maxItems * 4), profile });
    stageStarted = performance.now();
    const hardCeiling = Math.min(1900, budget.maxEstimatedTokens);
    const ceilings = { orientation: budget.orientationCeiling ?? 250, exact: budget.exactImplementationCeiling ?? 700, mandatory: budget.mandatoryContextReserve ?? 350, tests: budget.directTestReserve ?? 350, optional: budget.optionalContextCeiling ?? 250 };
    const sections = { orientation: [] as ContextPacketItem[], exact: [] as ContextPacketItem[], mandatory: [] as ContextPacketItem[], tests: [] as ContextPacketItem[], optional: [] as ContextPacketItem[] };
    const sectionTokens = { orientation: 0, exact: 0, mandatory: 0, tests: 0, optional: 0 };
    const omissions: ContextPacketOmission[] = [], selectedIds = new Set<string>(), hashes = new Set<string>(), paths = new Map<string, ContextCandidate[]>();
    let total = 0;
    const omit = (candidate: ContextCandidate, reason: ContextPacketOmission["reason"]) => { if (!omissions.some((item) => item.contextItemVersionId === candidate.item.id)) omissions.push({ contextItemVersionId: candidate.item.id, title: candidate.item.title ?? candidate.item.symbol_name ?? candidate.item.source_path, reason, estimatedTokens: candidate.estimatedTokens }); };
    const add = (candidate: ContextCandidate, section: keyof typeof sections, mandatory: boolean, strictSection = false): boolean => {
      if (selectedIds.has(candidate.item.id) || hashes.has(candidate.item.content_hash)) { omit(candidate, "duplicate"); return false; }
      const samePath = paths.get(candidate.item.source_path) ?? [];
      const fileScoped = !candidate.item.symbol_name;
      const contained = samePath.find((entry) => Boolean(entry.item.symbol_name) !== Boolean(candidate.item.symbol_name));
      if (contained && !candidate.coverageCategories.some((category) => !contained.coverageCategories.includes(category))) { omit(candidate, "diversity"); return false; }
      if (candidate.estimatedTokens > budget.maxEstimatedTokensPerItem) { omit(candidate, "oversized"); return false; }
      if (total + candidate.estimatedTokens > hardCeiling || selectedIds.size >= budget.maxItems) { omit(candidate, "budget"); return false; }
      if (sectionTokens[section] + candidate.estimatedTokens > ceilings[section] && (strictSection || !mandatory)) { omit(candidate, "budget"); return false; }
      sections[section].push({ candidate, content: candidate.item.compiled_content ?? candidate.item.content, truncated: false });
      sectionTokens[section] += candidate.estimatedTokens; total += candidate.estimatedTokens; selectedIds.add(candidate.item.id); hashes.add(candidate.item.content_hash); paths.set(candidate.item.source_path, [...samePath, candidate]);
      return true;
    };
    const exactScore = (candidate: ContextCandidate) => candidate.components.exactSymbol + candidate.components.exactTitle + candidate.components.exactPath;
    const exact = candidates.filter((candidate) => exactScore(candidate) > 0).sort((left, right) => Number(left.coverageCategories.includes("tests")) - Number(right.coverageCategories.includes("tests")) || right.score - left.score);
    for (const candidate of exact) add(candidate, "exact", true);
    const requiredCategories = analysis.requiredCoverage.filter((item) => item.state === "required").map((item) => item.category);
    for (const category of requiredCategories) {
      if ([...selectedIds].some((id) => candidates.find((candidate) => candidate.item.id === id)?.coverageCategories.includes(category))) continue;
      const match = candidates.filter((candidate) => candidate.coverageCategories.includes(category)).sort((left, right) => right.score - left.score || left.estimatedTokens - right.estimatedTokens)[0];
      if (match) add(match, "mandatory", true);
    }
    const testCandidates = candidates.filter((candidate) => candidate.coverageCategories.includes("tests") && (candidate.components.testRelation > 0 || candidate.components.dependencyRelation > 0 || candidate.components.lexical >= 0.3 || exactScore(candidate) > 0));
    for (const candidate of testCandidates) add(candidate, "tests", false, true);
    const orientationCandidates = candidates.filter((candidate) => candidate.coverageCategories.some((category) => ["architecture", "repository_state", "documentation"].includes(category)) && candidate.score >= 3);
    for (const candidate of orientationCandidates) add(candidate, "orientation", false, true);
    for (const candidate of candidates.filter((candidate) => candidate.score >= 3.5)) add(candidate, "optional", false, true);
    for (const candidate of candidates) if (!selectedIds.has(candidate.item.id)) omit(candidate, candidate.estimatedTokens > budget.maxEstimatedTokensPerItem ? "oversized" : "budget");
    addTiming(profile, "diversitySelection", elapsed(stageStarted));
    stageStarted = performance.now();
    const selected = [...sections.orientation, ...sections.exact, ...sections.mandatory, ...sections.tests, ...sections.optional];
    const escalation = candidates.filter((item) => !selectedIds.has(item.item.id)).slice(0, 10).map((candidate) => ({ candidate, content: "", truncated: false }));
    const coverage = this.coverageFor(analysis, selected.map((item) => item.candidate), candidates);
    const implementationItems = [...sections.exact, ...sections.mandatory, ...sections.tests, ...sections.optional];
    const asSection = (items: ContextPacketItem[]) => ({ items, estimatedTokens: items.reduce((sum, item) => sum + item.candidate.estimatedTokens, 0) });
    const packet: CompiledContextPacket = { id: crypto.randomUUID(), repositoryId: this.repositoryId, snapshot: this.snapshot, task: analysis, budget: { ...budget, maxEstimatedTokens: hardCeiling, ...{ orientationCeiling: ceilings.orientation, exactImplementationCeiling: ceilings.exact, mandatoryContextReserve: ceilings.mandatory, directTestReserve: ceilings.tests, optionalContextCeiling: ceilings.optional } }, orientation: asSection(sections.orientation), exactImplementation: asSection(sections.exact), mandatoryContext: asSection(sections.mandatory), directlyRelatedTests: asSection(sections.tests), optionalContext: asSection(sections.optional), implementation: asSection(implementationItems), escalationCandidates: { items: escalation, estimatedTokens: 0 }, coverage, totalEstimatedTokens: total, omittedItems: omissions, complete: coverage.complete, incompleteReasons: coverage.missing.map((category) => `Missing required category: ${category}`), strategyVersion: CONTEXT_COMPILER_STRATEGY, generatedAt: new Date().toISOString() };
    this.repository.recordCompilerRetrieval({ id: crypto.randomUUID(), query: task, strategy: CONTEXT_COMPILER_STRATEGY, taskAnalysisJson: JSON.stringify(analysis), packetJson: JSON.stringify(packet), candidates, includedVersionIds: [...selectedIds] });
    addTiming(profile, "packetAssembly", elapsed(stageStarted));
    return packet;
  }

  explain(itemId: string): ContextItemVersion | undefined { return this.repository.findVersionById(this.repositoryId, itemId); }
}
