import { createDmReply, createPost, createTweetReply } from "#/lib/queries";
import type { CliCommandContext } from "./command-context";

export function registerComposeCommands({
	program,
	print,
	asJson,
	autoSyncAfterWrite,
}: CliCommandContext) {
	const composeCommand = program
		.command("compose")
		.description("Create local/xurl actions");

	composeCommand
		.command("post <text>")
		.option("--account <accountId>", "Account id", "acct_primary")
		.action(async (text, options) => {
			const result = await createPost(options.account, text);
			await autoSyncAfterWrite();
			print(result, asJson());
		});

	composeCommand
		.command("reply <tweetId> <text>")
		.option("--account <accountId>", "Account id", "acct_primary")
		.action(async (tweetId, text, options) => {
			const result = await createTweetReply(options.account, tweetId, text);
			await autoSyncAfterWrite();
			print(result, asJson());
		});

	composeCommand
		.command("dm <conversationId> <text>")
		.description("Reply inside an existing DM conversation")
		.action(async (conversationId, text) => {
			const result = await createDmReply(conversationId, text);
			await autoSyncAfterWrite();
			print(result, asJson());
		});
}
