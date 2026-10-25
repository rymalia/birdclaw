import type { Database } from "./sqlite";

export interface DatabaseMigration {
	version: number;
	name: string;
	up: (db: Database) => void;
}

export function getDatabaseSchemaVersion(db: Database) {
	return Number(db.pragma("user_version", { simple: true }) ?? 0);
}

export function runDatabaseMigrations(
	db: Database,
	migrations: readonly DatabaseMigration[],
) {
	let currentVersion = getDatabaseSchemaVersion(db);
	const pending = [...migrations]
		.filter((migration) => migration.version > currentVersion)
		.sort((left, right) => left.version - right.version);

	for (const migration of pending) {
		if (migration.version !== currentVersion + 1) {
			throw new Error(
				`Missing database migration between versions ${String(currentVersion)} and ${String(migration.version)}`,
			);
		}
		db.transaction(() => {
			migration.up(db);
			db.pragma(`user_version = ${String(migration.version)}`);
		})();
		currentVersion = migration.version;
	}

	return currentVersion;
}
