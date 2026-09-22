export type BertMode = "idle" | "thinking" | "tool" | "error" | "tired" | "done" | "waiting" | "compacting";
export type BertPose = "neutral" | "annoyed" | "gesturing" | "tired";
export type BertMouth = "closed" | "wide-open" | "rounded" | "tucked-lip" | "smile";

export interface BertVisual {
	mode: BertMode;
	pose: BertPose;
	caption: string;
	animated: boolean;
	staticMouth: BertMouth;
}

export interface BertActivityState {
	agentStartedAt?: number;
	activeTools: string[];
	waiting: boolean;
	compacting: boolean;
	errorUntil: number;
	errorTool?: string;
	doneUntil: number;
	preview?: {
		mode: BertMode;
		until: number;
	};
}

export const LONG_OPERATION_MS = 12_000;
export const ERROR_HOLD_MS = 2_000;
export const DONE_HOLD_MS = 1_200;
export const PREVIEW_HOLD_MS = 5_000;
export const FRAME_INTERVAL_MS = 140;

export const MOUTH_CYCLE: readonly BertMouth[] = [
	"closed",
	"wide-open",
	"closed",
	"rounded",
	"closed",
	"tucked-lip",
	"closed",
	"smile",
];

function toolCaption(toolName: string | undefined): string {
	return toolName ? `Bert is using ${toolName}…` : "Bert is using a tool…";
}

export function visualForMode(mode: BertMode, toolName?: string): BertVisual {
	switch (mode) {
		case "idle":
			return { mode, pose: "neutral", caption: "Bert is ready.", animated: false, staticMouth: "closed" };
		case "thinking":
			return { mode, pose: "neutral", caption: "Bert is thinking…", animated: true, staticMouth: "closed" };
		case "tool":
			return { mode, pose: "gesturing", caption: toolCaption(toolName), animated: true, staticMouth: "closed" };
		case "error":
			return {
				mode,
				pose: "annoyed",
				caption: toolName ? `${toolName} did not work.` : "That did not work.",
				animated: true,
				staticMouth: "closed",
			};
		case "tired":
			return { mode, pose: "tired", caption: "Bert is getting tired…", animated: true, staticMouth: "closed" };
		case "done":
			return { mode, pose: "neutral", caption: "Done!", animated: false, staticMouth: "smile" };
		case "waiting":
			return {
				mode,
				pose: "neutral",
				caption: "Bert is waiting for you…",
				animated: false,
				staticMouth: "closed",
			};
		case "compacting":
			return { mode, pose: "tired", caption: "Bert is compacting…", animated: true, staticMouth: "closed" };
	}
}

export function selectVisual(state: BertActivityState, now: number): BertVisual {
	if (state.preview && state.preview.until > now) {
		return visualForMode(state.preview.mode, state.activeTools.at(-1));
	}
	if (state.errorUntil > now) {
		return visualForMode("error", state.errorTool);
	}
	if (state.waiting) {
		return visualForMode("waiting");
	}
	if (state.compacting) {
		return visualForMode("compacting");
	}
	if (state.agentStartedAt !== undefined && now - state.agentStartedAt >= LONG_OPERATION_MS) {
		return visualForMode("tired");
	}
	if (state.activeTools.length > 0) {
		return visualForMode("tool", state.activeTools.at(-1));
	}
	if (state.agentStartedAt !== undefined) {
		return visualForMode("thinking");
	}
	if (state.doneUntil > now) {
		return visualForMode("done");
	}
	return visualForMode("idle");
}

export interface BertSnapshot extends BertVisual {
	mouth: BertMouth;
}

type Listener = () => void;

export class BertAnimator {
	private readonly state: BertActivityState = {
		activeTools: [],
		waiting: false,
		compacting: false,
		errorUntil: 0,
		doneUntil: 0,
	};
	private readonly toolNames = new Map<string, string>();
	private readonly listeners = new Set<Listener>();
	private interval?: ReturnType<typeof setInterval>;
	private mouthIndex = 0;
	private lastMode?: BertMode;
	private enabled = true;

	start(): void {
		if (this.interval) return;
		this.interval = setInterval(() => this.tick(), FRAME_INTERVAL_MS);
		this.emit();
	}

	stop(): void {
		if (this.interval) clearInterval(this.interval);
		this.interval = undefined;
		this.listeners.clear();
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		this.emit();
	}

	snapshot(now = Date.now()): BertSnapshot {
		const visual = selectVisual(this.state, now);
		const mouth = visual.animated ? MOUTH_CYCLE[this.mouthIndex % MOUTH_CYCLE.length]! : visual.staticMouth;
		return { ...visual, mouth };
	}

	startAgent(now = Date.now()): void {
		this.state.agentStartedAt = now;
		this.state.doneUntil = 0;
		this.emit();
	}

	settleAgent(now = Date.now()): void {
		this.state.agentStartedAt = undefined;
		this.toolNames.clear();
		this.syncTools();
		this.state.doneUntil = now + DONE_HOLD_MS;
		this.emit();
	}

	startTool(id: string, name: string): void {
		this.toolNames.set(id, name);
		this.syncTools();
		this.emit();
	}

	finishTool(id: string, isError: boolean, now = Date.now()): void {
		const name = this.toolNames.get(id);
		this.toolNames.delete(id);
		this.syncTools();
		if (isError) {
			this.state.errorTool = name;
			this.state.errorUntil = now + ERROR_HOLD_MS;
		}
		this.emit();
	}

	setWaiting(waiting: boolean): void {
		this.state.waiting = waiting;
		this.emit();
	}

	setCompacting(compacting: boolean): void {
		this.state.compacting = compacting;
		this.emit();
	}

	preview(mode: BertMode, now = Date.now()): void {
		this.state.preview = { mode, until: now + PREVIEW_HOLD_MS };
		this.emit();
	}

	private syncTools(): void {
		this.state.activeTools = [...this.toolNames.values()];
	}

	private tick(): void {
		const visual = selectVisual(this.state, Date.now());
		const modeChanged = visual.mode !== this.lastMode;
		if (modeChanged) this.mouthIndex = 0;
		else if (visual.animated) this.mouthIndex++;

		if (modeChanged || visual.animated) this.emit();
	}

	private emit(): void {
		const mode = selectVisual(this.state, Date.now()).mode;
		if (mode !== this.lastMode) {
			this.lastMode = mode;
			this.mouthIndex = 0;
		}
		for (const listener of this.listeners) listener();
	}
}
