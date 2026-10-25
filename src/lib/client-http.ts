export interface ResponseErrorOptions {
	label: string;
	statusMessages?: Readonly<Record<number, string>>;
}

/** Build a useful error from JSON or plain-text non-OK responses. */
export async function responseError(
	response: Response,
	{ label, statusMessages }: ResponseErrorOptions,
) {
	const specialMessage = statusMessages?.[response.status];
	if (specialMessage) return new Error(specialMessage);

	const status = `${String(response.status)}${response.statusText ? ` ${response.statusText}` : ""}`;
	let detail = "";
	try {
		const contentType = response.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			const payload: unknown = await response.json();
			if (payload && typeof payload === "object") {
				const record = payload as { error?: unknown; message?: unknown };
				if (typeof record.message === "string") detail = record.message;
				else if (typeof record.error === "string") detail = record.error;
			}
		} else {
			detail = (await response.text()).trim();
		}
	} catch {
		detail = "";
	}
	return new Error(
		detail ? `${label} (${status}): ${detail}` : `${label} (${status})`,
	);
}
