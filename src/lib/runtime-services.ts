export interface RuntimeServices {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
	now(): Date;
	random(): number;
	env(name: string): string | undefined;
}

export const defaultRuntimeServices: RuntimeServices = {
	fetch: (input, init) =>
		init === undefined
			? globalThis.fetch(input)
			: globalThis.fetch(input, init),
	now: () => new Date(),
	random: () => Math.random(),
	env: (name) =>
		typeof process === "undefined" ? undefined : process.env[name],
};

export function createRuntimeServices(
	overrides: Partial<RuntimeServices> = {},
): RuntimeServices {
	return { ...defaultRuntimeServices, ...overrides };
}
