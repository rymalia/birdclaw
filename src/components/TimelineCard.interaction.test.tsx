import {
	cleanup,
	createEvent,
	fireEvent,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	conversationQueryOptions,
	ConversationSurfaceScope,
} from "#/lib/conversation-surface";
import type { TimelineItem } from "#/lib/types";
import { renderWithQueryClient } from "#/test/render";
import { TimelineCard } from "./TimelineCard";

const item: TimelineItem = {
	id: "touch_a",
	accountId: "acct_demo",
	accountHandle: "@demo",
	kind: "home",
	text: "Synthetic touch interaction",
	createdAt: "2026-09-17T12:00:00.000Z",
	isReplied: false,
	likeCount: 0,
	mediaCount: 0,
	bookmarked: false,
	liked: false,
	author: {
		id: "profile_demo",
		handle: "demo",
		displayName: "Demo",
		bio: "",
		followersCount: 0,
		avatarHue: 100,
		createdAt: "2026-09-17T12:00:00.000Z",
	},
	entities: {},
	media: [],
};

function pointerClick(target: Element, pointerType: string) {
	const event = createEvent.click(target, { detail: 1 });
	Object.defineProperty(event, "pointerType", { value: pointerType });
	fireEvent(target, event);
}

function compatibilityClick(target: Element, pointerType: string) {
	const event = createEvent.pointerDown(target);
	Object.defineProperty(event, "pointerType", { value: pointerType });
	fireEvent(target, event);
	fireEvent.click(target, { detail: 1 });
}

function conversationItems(id: string) {
	return [
		{ ...item, id, text: `Context for ${id}`, replyToId: null },
		{ ...item, id: `${id}_reply`, text: `Reply for ${id}`, replyToId: id },
	];
}

function setup() {
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const id = new URL(String(input), "http://localhost").searchParams.get(
			"tweetId",
		)!;
		return {
			ok: true,
			json: async () => ({
				ok: true,
				items: id === "touch_empty" ? [] : conversationItems(id),
			}),
		};
	});
	vi.stubGlobal("fetch", fetchMock);
	const { container, queryClient } = renderWithQueryClient(
		<ConversationSurfaceScope>
			{["touch_a", "touch_b", "touch_empty"].map((id) => (
				<TimelineCard key={id} item={{ ...item, id }} onReply={vi.fn()} />
			))}
		</ConversationSurfaceScope>,
	);
	const rows = container.querySelectorAll<HTMLElement>(
		"[data-perf='timeline-card']",
	);
	return {
		fetchMock,
		queryClient,
		first: rows[0]!,
		second: rows[1]!,
		empty: rows[2]!,
	};
}

function threadButton(row: HTMLElement) {
	return within(row).getByRole("button", { name: "Show conversation" });
}

describe("timeline touch interactions", () => {
	afterEach(() => {
		cleanup();
		window.getSelection()?.removeAllRanges();
		vi.unstubAllGlobals();
	});

	it.each([
		["pointer click", pointerClick],
		["compatibility mouse click", compatibilityClick],
	] as const)(
		"dismisses without opening or switching with a %s",
		async (_name, click) => {
			const { first, second, empty, fetchMock } = setup();
			click(first, "touch");
			expect(fetchMock).not.toHaveBeenCalled();
			expect(screen.queryByText("Hide thread")).not.toBeInTheDocument();

			click(threadButton(first), "touch");
			expect(
				await screen.findByText("Context for touch_a"),
			).toBeInTheDocument();
			click(first, "touch");
			expect(screen.queryByText("Context for touch_a")).not.toBeInTheDocument();

			click(threadButton(first), "touch");
			expect(
				await screen.findByText("Context for touch_a"),
			).toBeInTheDocument();
			click(second, "touch");
			expect(screen.queryByText("Hide thread")).not.toBeInTheDocument();
			expect(fetchMock).not.toHaveBeenCalledWith(
				"/api/conversation?tweetId=touch_b",
			);

			fireEvent.mouseEnter(empty);
			expect(await within(empty).findByText("no threads")).toBeInTheDocument();
			click(threadButton(first), "touch");
			click(empty, "touch");
			expect(screen.queryByText("Hide thread")).not.toBeInTheDocument();

			click(first, "mouse");
			expect(
				await screen.findByText("Context for touch_a"),
			).toBeInTheDocument();
			click(second, "mouse");
			expect(
				await screen.findByText("Context for touch_b"),
			).toBeInTheDocument();
			expect(screen.queryByText("Context for touch_a")).not.toBeInTheDocument();
			click(second, "touch");
			fireEvent.click(threadButton(first), { detail: 0 });
			expect(
				await screen.findByText("Context for touch_a"),
			).toBeInTheDocument();
		},
	);

	it("keeps a dismissed pending conversation closed when its response arrives", async () => {
		const { first, second, fetchMock, queryClient } = setup();
		let complete!: (value: Awaited<ReturnType<typeof fetchMock>>) => void;
		fetchMock.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		pointerClick(threadButton(first), "touch");
		expect(screen.getByText("Hide thread")).toBeInTheDocument();
		pointerClick(second, "touch");
		expect(screen.queryByText("Hide thread")).not.toBeInTheDocument();
		complete({
			ok: true,
			json: async () => ({ ok: true, items: conversationItems("touch_a") }),
		});
		await waitFor(() => {
			expect(
				queryClient.getQueryState(conversationQueryOptions("touch_a").queryKey)
					?.status,
			).toBe("success");
		});
		expect(screen.queryByText("Context for touch_a")).not.toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("preserves link activation and text selection while a thread is open", async () => {
		const { first } = setup();
		pointerClick(threadButton(first), "touch");
		expect(await screen.findByText("Context for touch_a")).toBeInTheDocument();
		const link = within(first).getAllByRole("link", { name: "Demo@demo" })[0]!;
		const activated = vi.fn((event: Event) => event.preventDefault());
		link.addEventListener("click", activated);
		pointerClick(link, "touch");
		expect(activated).toHaveBeenCalledOnce();
		expect(screen.getByText("Context for touch_a")).toBeInTheDocument();

		const text = within(first).getByText(item.text);
		const range = document.createRange();
		range.selectNodeContents(text);
		window.getSelection()?.addRange(range);
		pointerClick(text, "touch");
		expect(window.getSelection()?.toString()).toBe(item.text);
		expect(screen.getByText("Context for touch_a")).toBeInTheDocument();
		pointerClick(text, "mouse");
		expect(screen.getByText("Context for touch_a")).toBeInTheDocument();
	});
});
