export function parseJsonObject(
	value: unknown,
): Record<string, unknown> | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;

	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}
