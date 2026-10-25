import { z } from "zod";

export interface ConsumeNdjsonOptions<T> {
	body: ReadableStream<Uint8Array>;
	schema: z.ZodType<T>;
	onEvent: (event: T) => void | Promise<void>;
	isTerminal?: (event: T) => boolean;
	signal?: AbortSignal;
	prematureEofError?: () => Error;
}

function abortError(signal: AbortSignal) {
	return signal.reason instanceof Error
		? signal.reason
		: new DOMException("The operation was aborted", "AbortError");
}

async function readWithAbort(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	signal?: AbortSignal,
) {
	if (!signal) return reader.read();
	if (signal.aborted) throw abortError(signal);

	return new Promise<ReadableStreamReadResult<Uint8Array>>(
		(resolve, reject) => {
			const onAbort = () => {
				void reader.cancel(signal.reason).catch(() => undefined);
				reject(abortError(signal));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			reader
				.read()
				.then(resolve, reject)
				.finally(() => {
					signal.removeEventListener("abort", onAbort);
				});
		},
	);
}

/** Consume and validate a newline-delimited JSON response body. */
export async function consumeNdjson<T>({
	body,
	schema,
	onEvent,
	isTerminal = () => false,
	signal,
	prematureEofError = () =>
		new Error("Stream closed before a terminal event was received"),
}: ConsumeNdjsonOptions<T>) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let terminal = false;

	const consumeLine = async (line: string) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		const event = schema.parse(JSON.parse(trimmed));
		await onEvent(event);
		if (isTerminal(event)) terminal = true;
	};

	try {
		for (;;) {
			const { done, value } = await readWithAbort(reader, signal);
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				await consumeLine(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
			}
		}
		buffer += decoder.decode();
		await consumeLine(buffer);
		if (!terminal) throw prematureEofError();
	} finally {
		reader.releaseLock();
	}
}
