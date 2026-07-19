import type { ContextCoverageCategory } from "@continuum/shared";
export type RetrievalBenchmarkCategory = "exact_symbol"|"exact_path"|"local_bug"|"cross_package"|"test_failure"|"security"|"database_migration"|"api_contract"|"configuration"|"documentation_mismatch"|"ambiguous_behaviour";
export interface RetrievalBenchmarkCase { id:string;repositoryFixture:string;task:string;category:RetrievalBenchmarkCategory;requiredItemIds:string[];requiredPaths:string[];requiredSymbols:string[];requiredCoverage:ContextCoverageCategory[];optionalRelevantItemIds?:string[];explicitlyIrrelevantItemIds?:string[] }
export interface RetrievalBenchmarkDataset { schemaVersion:"continuum.retrieval-benchmark.v1";groundTruthPolicy:string;cases:RetrievalBenchmarkCase[] }
