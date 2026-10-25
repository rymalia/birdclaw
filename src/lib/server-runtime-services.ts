import { getBirdclawPaths, type BirdclawPaths } from "./config";
import { getNativeDb, type InitDatabaseOptions } from "./db";
import {
	createRuntimeServices,
	defaultRuntimeServices,
	type RuntimeServices,
} from "./runtime-services";
import type { Database } from "./sqlite";

export interface ServerRuntimeServices extends RuntimeServices {
	getDatabase(options?: InitDatabaseOptions): Database;
	getPaths(): BirdclawPaths;
}

export const defaultServerRuntimeServices: ServerRuntimeServices = {
	...defaultRuntimeServices,
	getDatabase: (options) => getNativeDb(options),
	getPaths: () => getBirdclawPaths(),
};

export function createServerRuntimeServices(
	overrides: Partial<ServerRuntimeServices> = {},
): ServerRuntimeServices {
	return {
		...createRuntimeServices(overrides),
		getDatabase:
			overrides.getDatabase ?? defaultServerRuntimeServices.getDatabase,
		getPaths: overrides.getPaths ?? defaultServerRuntimeServices.getPaths,
	};
}
