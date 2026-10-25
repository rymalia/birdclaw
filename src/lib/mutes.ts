import {
	createModerationActions,
	listModerationState,
	type ModerationItem,
} from "./moderation-state";

const muteActions = createModerationActions("mute");

export function addMute(...args: Parameters<typeof muteActions.add>) {
	return muteActions.add(...args);
}

export function addMuteEffect(
	...args: Parameters<typeof muteActions.addEffect>
) {
	return muteActions.addEffect(...args);
}

export function recordMute(...args: Parameters<typeof muteActions.record>) {
	return muteActions.record(...args);
}

export function removeMute(...args: Parameters<typeof muteActions.remove>) {
	return muteActions.remove(...args);
}

export function removeMuteEffect(
	...args: Parameters<typeof muteActions.removeEffect>
) {
	return muteActions.removeEffect(...args);
}

export type MuteItem = ModerationItem<"mute">;

export function listMutes({
	account,
	search,
	limit = 50,
}: {
	account?: string;
	search?: string;
	limit?: number;
} = {}): MuteItem[] {
	return listModerationState("mute", { account, search, limit });
}
