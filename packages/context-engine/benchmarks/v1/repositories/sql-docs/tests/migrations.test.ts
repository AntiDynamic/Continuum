import { applyMigrations, rollbackMigration } from "../src/migration-runner";
export function migrationRoundTripTest(): boolean { return applyMigrations(["001"]).applied === rollbackMigration("001").rolledBack; }
