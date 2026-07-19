export interface MigrationResult { applied: number; rolledBack: number; }
export function applyMigrations(names: string[]): MigrationResult { return { applied: names.length, rolledBack: 0 }; }
export function rollbackMigration(name: string): MigrationResult { return { applied: 0, rolledBack: name ? 1 : 0 }; }
