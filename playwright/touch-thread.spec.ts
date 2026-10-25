import { expect, test } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 430, height: 932 } });

test.beforeEach(async ({ context, baseURL }) => {
	if (!baseURL) throw new Error("Playwright baseURL is required");
	await context.addCookies([
		{ name: "birdclaw_token", value: "birdclaw-e2e-token", url: baseURL },
	]);
});

test("touch dismisses threads while mouse, keyboard, and links retain their behavior", async ({
	page,
}) => {
	await page.goto("/");
	const cards = page.locator('[data-perf="timeline-card"]');
	const first = cards.filter({
		has: page.locator('footer a[href="/tweets/tweet_001"]'),
	});
	const text = first.getByText(/^We need more software/).first();
	const conversation = page.getByRole("region", {
		name: "Conversation",
		exact: true,
	});
	const showThread = first.getByRole("button", { name: "Show conversation" });
	await expect(text).toBeVisible();

	await text.tap();
	await expect(conversation).toHaveCount(0);
	await expect(showThread).toHaveAttribute("aria-expanded", "false");
	await showThread.tap();
	await expect(conversation).toBeVisible();
	await text.tap();
	await expect(conversation).toHaveCount(0);

	const empty = cards.filter({
		hasText: "New developer-platform pricing survey",
	});
	await empty.hover();
	await expect(empty.getByText("no threads", { exact: true })).toBeVisible();
	await showThread.tap();
	await expect(conversation).toBeVisible();
	await empty.getByText(/^New developer-platform pricing survey/).tap();
	await expect(conversation).toHaveCount(0);

	await text.click();
	await expect(conversation).toBeVisible();
	await text.tap();
	await expect(conversation).toHaveCount(0);
	await showThread.focus();
	await page.keyboard.press("Enter");
	await expect(conversation).toBeVisible();
	await first
		.getByRole("link", { name: "Open archived post", exact: true })
		.first()
		.tap();
	await expect(page).toHaveURL(/\/tweets\/tweet_001$/);
	await expect(
		page.getByRole("article", { name: "Selected post" }),
	).toBeVisible();
});
