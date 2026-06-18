// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
	getDatabaseSchemaVersion,
	runDatabaseMigrations,
} from "./database-migrations";
import NativeSqliteDatabase from "./sqlite";

describe("database migrations", () => {
	it("runs each version once and records the latest version", () => {
		const db = new NativeSqliteDatabase(":memory:");
		const first = vi.fn((database: NativeSqliteDatabase) => {
			database.exec("create table events (name text)");
		});
		const second = vi.fn((database: NativeSqliteDatabase) => {
			database.exec("alter table events add column detail text");
		});
		const migrations = [
			{ version: 1, name: "events", up: first },
			{ version: 2, name: "event details", up: second },
		];

		expect(runDatabaseMigrations(db, migrations)).toBe(2);
		expect(runDatabaseMigrations(db, migrations)).toBe(2);
		expect(getDatabaseSchemaVersion(db)).toBe(2);
		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
		db.close();
	});

	it("rejects gaps instead of silently skipping schema history", () => {
		const db = new NativeSqliteDatabase(":memory:");

		expect(() =>
			runDatabaseMigrations(db, [
				{ version: 2, name: "gap", up: () => undefined },
			]),
		).toThrow("Missing database migration");
		expect(getDatabaseSchemaVersion(db)).toBe(0);
		db.close();
	});

	it("rolls back the schema and version when a migration fails", () => {
		const db = new NativeSqliteDatabase(":memory:");

		expect(() =>
			runDatabaseMigrations(db, [
				{
					version: 1,
					name: "broken migration",
					up: (database) => {
						database.exec("create table partial_change (value text)");
						throw new Error("migration failed");
					},
				},
			]),
		).toThrow("migration failed");
		expect(getDatabaseSchemaVersion(db)).toBe(0);
		expect(
			db
				.prepare(
					"select name from sqlite_master where type = 'table' and name = 'partial_change'",
				)
				.get(),
		).toBeUndefined();
		db.close();
	});
});
