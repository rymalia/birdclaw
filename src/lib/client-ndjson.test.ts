import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { responseError } from "./client-http";
import { consumeNdjson } from "./client-ndjson";

const eventSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("delta"), delta: z.string() }),
	z.object({ type: z.literal("done"), value: z.number() }),
]);
type Event = z.infer<typeof eventSchema>;

function chunkedBody(chunks: Uint8Array[]) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
}

async function consume(chunks: Uint8Array[], onEvent = vi.fn()) {
	await consumeNdjson({
		body: chunkedBody(chunks),
		schema: eventSchema,
		onEvent,
		isTerminal: (event) => event.type === "done",
	});
	return onEvent;
}

describe("consumeNdjson", () => {
	it("decodes an event split at every possible byte boundary", async () => {
		const bytes = new TextEncoder().encode(
			`${JSON.stringify({ type: "delta", delta: "héllo 🦞" })}\n${JSON.stringify({ type: "done", value: 1 })}\n`,
		);
		for (let split = 1; split < bytes.length; split += 1) {
			const onEvent = await consume([
				bytes.slice(0, split),
				bytes.slice(split),
			]);
			expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
				{ type: "delta", delta: "héllo 🦞" },
				{ type: "done", value: 1 },
			]);
		}
	});

	it("handles multiple events, blank lines, and a final line without newline", async () => {
		const body = new TextEncoder().encode(
			`\n${JSON.stringify({ type: "delta", delta: "a" })}\n  \n${JSON.stringify({ type: "done", value: 2 })}`,
		);
		const onEvent = await consume([body]);
		expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
			{ type: "delta", delta: "a" },
			{ type: "done", value: 2 },
		]);
	});

	it("rejects invalid JSON", async () => {
		await expect(
			consume([new TextEncoder().encode("not-json\n")]),
		).rejects.toBeInstanceOf(SyntaxError);
	});

	it("rejects events that fail schema validation", async () => {
		await expect(
			consume([
				new TextEncoder().encode(
					`${JSON.stringify({ type: "delta", delta: 1 })}\n`,
				),
			]),
		).rejects.toBeInstanceOf(z.ZodError);
	});

	it("rejects premature EOF", async () => {
		await expect(
			consume([
				new TextEncoder().encode(
					`${JSON.stringify({ type: "delta", delta: "partial" })}\n`,
				),
			]),
		).rejects.toThrow("Stream closed before a terminal event was received");
	});

	it("propagates abort while waiting for the next body chunk", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			cancel() {
				cancelled = true;
			},
		});
		const controller = new AbortController();
		const promise = consumeNdjson<Event>({
			body,
			schema: eventSchema,
			onEvent: vi.fn(),
			isTerminal: (event) => event.type === "done",
			signal: controller.signal,
		});
		controller.abort();
		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelled).toBe(true);
	});
});

describe("responseError", () => {
	it("uses JSON message and error details", async () => {
		await expect(
			responseError(
				new Response(JSON.stringify({ message: "bad token" }), {
					status: 401,
					statusText: "Unauthorized",
					headers: { "content-type": "application/json" },
				}),
				{ label: "Request failed" },
			),
		).resolves.toMatchObject({
			message: "Request failed (401 Unauthorized): bad token",
		});
		await expect(
			responseError(
				new Response(JSON.stringify({ error: "server broke" }), {
					status: 500,
					headers: { "content-type": "application/json" },
				}),
				{ label: "Request failed" },
			),
		).resolves.toMatchObject({
			message: "Request failed (500): server broke",
		});
	});

	it("falls back to plain text and supports special statuses", async () => {
		await expect(
			responseError(new Response("plain failure", { status: 503 }), {
				label: "Request failed",
			}),
		).resolves.toMatchObject({
			message: "Request failed (503): plain failure",
		});
		await expect(
			responseError(new Response(null, { status: 524 }), {
				label: "Request failed",
				statusMessages: { 524: "proxy timeout" },
			}),
		).resolves.toMatchObject({ message: "proxy timeout" });
	});
});
