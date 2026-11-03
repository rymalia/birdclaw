import { LAST_PRE_SNOWFLAKE_TWEET_ID, X_SNOWFLAKE_EPOCH_MS } from "./snowflake";
import type { Database } from "./sqlite";

export interface DateRepairResult {
	tweetsCreatedAtRepaired: number;
	placeholdersLeft: number;
	collectionsPlaceholderCleared: number;
}

const LAST_PRE_SNOWFLAKE_TWEET_ID_SQL = LAST_PRE_SNOWFLAKE_TWEET_ID.toString();
const SNOWFLAKE_EPOCH_MS_SQL = X_SNOWFLAKE_EPOCH_MS.toString();

const REPAIRABLE_TWEET_PREDICATE = `
	created_at like '1970-01-01%'
	and id glob '[0-9]*'
	and id not glob '*[^0-9]*'
	and length(id) >= ${LAST_PRE_SNOWFLAKE_TWEET_ID_SQL.length}
	and cast(id as integer) > ${LAST_PRE_SNOWFLAKE_TWEET_ID_SQL}
`;

const TWEET_DATE_REPAIR_SQL = `
	strftime(
		'%Y-%m-%dT%H:%M:%fZ',
		(((cast(id as integer) >> 22) + ${SNOWFLAKE_EPOCH_MS_SQL}) / 1000.0),
		'unixepoch'
	)
`;

function countRows(db: Database, sql: string) {
	const row = db.prepare(sql).get() as { count: number };
	return Number(row.count);
}

function readRepairCounts(db: Database): DateRepairResult {
	return {
		tweetsCreatedAtRepaired: countRows(
			db,
			`select count(*) as count from tweets where ${REPAIRABLE_TWEET_PREDICATE}`,
		),
		placeholdersLeft: countRows(
			db,
			`select count(*) as count
			 from tweets
			 where created_at like '1970-01-01%'
			   and not (${REPAIRABLE_TWEET_PREDICATE})`,
		),
		collectionsPlaceholderCleared: countRows(
			db,
			"select count(*) as count from tweet_collections where collected_at like '1970-01-01%'",
		),
	};
}

export function repairDates(
	db: Database,
	{ dryRun = false }: { dryRun?: boolean } = {},
): DateRepairResult {
	if (dryRun) return db.readTransaction(() => readRepairCounts(db))();

	return db.transaction(() => {
		const result = readRepairCounts(db);
		db.prepare(`
			update tweets
			set created_at = ${TWEET_DATE_REPAIR_SQL}
			where ${REPAIRABLE_TWEET_PREDICATE}
		`).run();
		db.prepare(
			"update tweet_collections set collected_at = null where collected_at like '1970-01-01%'",
		).run();
		return result;
	})();
}
