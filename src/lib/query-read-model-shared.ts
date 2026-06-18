export function parseJsonField<T>(value: unknown, fallback: T): T {
	if (typeof value !== "string" || value.length === 0) {
		return fallback;
	}

	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function toFtsSearchQuery(value: string) {
	const terms = value.match(/[\p{L}\p{N}_]+/gu) ?? [];
	return terms
		.map((term) => term.trim())
		.filter((term) => term.length > 0)
		.map((term) => `"${term.replaceAll('"', '""')}"`)
		.join(" ");
}
