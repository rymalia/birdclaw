import { listInboxItems, scoreInbox } from "#/lib/inbox";
import type { CliCommandContext } from "./command-context";

export function registerInboxCommand({
	program,
	print,
	asJson,
	autoSyncAfterWrite,
	autoUpdateBeforeRead,
}: CliCommandContext) {
	program
		.command("inbox")
		.option("--kind <kind>", "mixed, mentions, or dms", "mixed")
		.option("--min-score <n>", "Minimum rank", "0")
		.option("--hide-low-signal", "Hide low-signal items")
		.option("--score", "Score top items with OpenAI before listing")
		.option("--limit <n>", "Limit results", "20")
		.action(async (options) => {
			await autoUpdateBeforeRead();
			const kind =
				options.kind === "mentions" || options.kind === "dms"
					? options.kind
					: "mixed";
			if (options.score) {
				await scoreInbox({
					kind,
					limit: Number(options.limit),
				});
				await autoSyncAfterWrite();
			}
			print(
				listInboxItems({
					kind,
					minScore: Number(options.minScore),
					hideLowSignal: Boolean(options.hideLowSignal),
					limit: Number(options.limit),
				}),
				asJson(),
			);
		});
}
