export { openDatabase, migrate, getSchemaVersion, probeSearchCapability } from "./connection.js";
export type { Db } from "./connection.js";
export { MIGRATIONS } from "./migrations.js";
export type { Migration } from "./migrations.js";
export { RunRepository, RepositoryRepository } from "./run-repository.js";
export type {
  AgentRunRow,
  CreateRunParams,
  FinishRunParams,
  RepositoryRow,
} from "./run-repository.js";
export { ContextRepository } from "./repositories/context-repository.js";
export { IndexRunRepository } from "./repositories/index-run-repository.js";
export type { RepositoryIndexRun } from "./repositories/index-run-repository.js";
export {
  EventRepository,
  GitSnapshotRepository,
  FileChangeRepository,
  TestRunRepository,
  UsageMetricRepository,
  UserOutcomeRepository,
} from "./event-repository.js";
export type {
  AgentEventRow,
  GitSnapshotRow,
  FileChangeRow,
  TestRunRow,
  UsageMetricRow,
  UserOutcomeRow,
} from "./event-repository.js";
export {
  PricingProfileRepository,
  UsageEvidenceRepository,
  CostEvidenceRepository,
  ContextLedgerRepository,
} from "./context-efficiency-repository.js";
export type { StoredUsageEvidence } from "./context-efficiency-repository.js";

export * from "./repositories/context-session-repository.js";
export * from "./repositories/codex-execution-repository.js";
