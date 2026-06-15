import type { Command } from "commander";

export interface CliCommandContext {
	program: Command;
	print: (data: unknown, asJson: boolean) => void;
	asJson: () => boolean;
	autoSyncAfterWrite: () => Promise<void>;
	autoUpdateBeforeRead: () => Promise<void>;
}
