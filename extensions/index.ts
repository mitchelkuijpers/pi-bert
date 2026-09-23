import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	getCapabilities,
	Image,
	truncateToWidth,
	visibleWidth,
	type Component,
	type OverlayHandle,
	type TUI,
} from "@earendil-works/pi-tui";
import { BertAnimator, type BertMode, type BertMouth, type BertPose } from "./state.ts";

const WIDGET_KEY = "pi-bert";
const OVERLAY_WIDTH = 24;
const IMAGE_WIDTH = 20;
const IMAGE_HEIGHT = 7;
const FRAME_DIMENSIONS = { widthPx: 320, heightPx: 204 };
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const FRAME_DIR = join(EXTENSION_DIR, "..", "assets", "frames");
const POSES: readonly BertPose[] = ["neutral", "annoyed", "gesturing", "tired"];
const MOUTHS: readonly BertMouth[] = ["closed", "wide-open", "rounded", "tucked-lip", "smile"];
const MODES: readonly BertMode[] = ["idle", "thinking", "tool", "error", "tired", "done", "waiting", "compacting"];

type FrameKey = `${BertPose}-${BertMouth}`;
type FrameMap = Record<FrameKey, string>;

function loadFrames(): FrameMap {
	const frames = {} as FrameMap;
	for (const pose of POSES) {
		for (const mouth of MOUTHS) {
			const key: FrameKey = `${pose}-${mouth}`;
			frames[key] = readFileSync(join(FRAME_DIR, `${key}.png`)).toString("base64");
		}
	}
	return frames;
}

type BertAnimateSetting = "auto" | "on" | "off";
const ANIMATE_SETTINGS: readonly BertAnimateSetting[] = ["auto", "on", "off"];

/**
 * Detects pi's fullscreen (alternate-screen) renderer through the TUI proxy.
 * The proxy forwards property reads to the active renderer, and only
 * TuiAltScreen declares the `altScreenActive` field, so this tracks runtime
 * renderer switches as well.
 */
function isAltScreenRenderer(tui: TUI | undefined): boolean {
	if (!tui) return false;
	return typeof (tui as unknown as Record<string, unknown>).altScreenActive === "boolean";
}

function centerLine(text: string, width: number): string {
	const clipped = truncateToWidth(text, Math.max(1, width));
	return `${" ".repeat(Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2)))}${clipped}`;
}

function asciiBert(theme: Theme, width: number): string[] {
	const art = ["  ╭────╮", "  │ •• │", "  │ ▄  │", "╭─╯    ╰─╮", "╰──┬──┬──╯"];
	return art.map((line) => centerLine(theme.fg("warning", line), width));
}

class BertComponent implements Component {
	// One Image per sprite frame: repeated frames reuse the same cached lines
	// and the same Kitty image id, so the diff renderer sees an unchanged line
	// and skips the delete/re-transmit cycle for them.
	private readonly imageCache = new Map<FrameKey, Image>();
	private readonly unsubscribe: () => void;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly animator: BertAnimator,
		private readonly frames: FrameMap,
		private readonly shouldAnimate: () => boolean,
	) {
		this.unsubscribe = animator.subscribe(() => this.tui.requestRender());
	}

	render(width: number): string[] {
		if (!this.animator.isEnabled()) return [];
		// Sync per render: keeps the animator in the right mode across runtime
		// fullscreen switches and widget recreation. Pi's main-screen
		// renderer deletes the image data of every kitty id found in a changed
		// line, so per-tick animation there means delete + re-upload at 7 Hz;
		// in that renderer Bert only changes frames on actual state changes.
		// setAnimationEnabled no-ops when the value is unchanged, so this does
		// not cause render loops.
		this.animator.setAnimationEnabled(this.shouldAnimate());
		const snapshot = this.animator.snapshot();
		const panelWidth = Math.max(1, Math.min(OVERLAY_WIDTH, width));
		const contentWidth = Math.max(1, Math.min(OVERLAY_WIDTH - 2, width));
		let imageLines: string[];

		if (!getCapabilities().images) {
			imageLines = asciiBert(this.theme, contentWidth);
		} else {
			const key: FrameKey = `${snapshot.pose}-${snapshot.mouth}`;
			let image = this.imageCache.get(key);
			if (!image) {
				image = new Image(
					this.frames[key],
					"image/png",
					{ fallbackColor: (text) => this.theme.fg("dim", text) },
					{
						maxWidthCells: IMAGE_WIDTH,
						maxHeightCells: IMAGE_HEIGHT,
						filename: `${key}.png`,
					},
					FRAME_DIMENSIONS,
				);
				this.imageCache.set(key, image);
			}
			imageLines = image.render(contentWidth);
		}

		const leftPad = Math.max(0, width - panelWidth);
		const paddedImage = imageLines.map((line) => `${" ".repeat(leftPad)}${line}`);
		const caption = centerLine(this.theme.fg("muted", snapshot.caption), panelWidth);
		return [...paddedImage, `${" ".repeat(leftPad)}${caption}`];
	}

	invalidate(): void {
		for (const image of this.imageCache.values()) image.invalidate();
	}

	dispose(): void {
		this.unsubscribe();
	}
}

export default function bertExtension(pi: ExtensionAPI): void {
	let animator: BertAnimator | undefined;
	let tui: TUI | undefined;
	let theme: Theme | undefined;
	let frames: FrameMap | undefined;
	let overlayHandle: OverlayHandle | undefined;
	let overlayComponent: BertComponent | undefined;
	let animateSetting: BertAnimateSetting = "auto";

	const shouldAnimate = (): boolean =>
		animateSetting === "on" || (animateSetting === "auto" && isAltScreenRenderer(tui));

	const showBert = (): void => {
		if (!animator?.isEnabled() || !tui || !theme || !frames || overlayHandle) return;
		overlayComponent = new BertComponent(tui, theme, animator, frames, shouldAnimate);
		overlayHandle = tui.showOverlay(overlayComponent, {
			anchor: "top-right",
			width: OVERLAY_WIDTH,
			minWidth: OVERLAY_WIDTH,
			maxHeight: 10,
			margin: { right: 1, top: 1 },
			nonCapturing: true,
		});
	};

	const hideBert = (): void => {
		overlayHandle?.hide();
		overlayHandle = undefined;
		overlayComponent?.dispose();
		overlayComponent = undefined;
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		try {
			frames = loadFrames();
		} catch (error) {
			ctx.ui.notify(`Bert could not load his sprites: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}

		animator = new BertAnimator();

		ctx.ui.setWidget(WIDGET_KEY, (componentTui, componentTheme) => {
			tui = componentTui;
			theme = componentTheme;
			showBert();
			return { render: () => [], invalidate: () => {} };
		});
		animator.start();
	});

	pi.on("agent_start", () => animator?.startAgent());
	pi.on("agent_settled", () => animator?.settleAgent());
	pi.on("tool_execution_start", (event) => animator?.startTool(event.toolCallId, event.toolName));
	pi.on("tool_execution_end", (event) => animator?.finishTool(event.toolCallId, event.isError));

	pi.on("ui_prompt_start", () => animator?.setWaiting(true));
	pi.on("ui_prompt_end", () => animator?.setWaiting(false));

	pi.on("session_before_compact", () => animator?.setCompacting(true));
	pi.on("session_compact", () => animator?.setCompacting(false));
	pi.on("session_compact_failed", () => animator?.setCompacting(false));

	pi.on("session_shutdown", (_event, ctx) => {
		hideBert();
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		animator?.stop();
		animator = undefined;
		tui = undefined;
	});

	pi.registerCommand("bert", {
		description: "Control Bert: /bert [on|off|animate <auto|on|off>|test <state>]",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui" || !animator) {
				ctx.ui.notify("Bert is only available in interactive TUI mode.", "warning");
				return;
			}

			const [command = "status", requestedMode] = args.trim().toLowerCase().split(/\s+/);
			if (command === "on") {
				animator.setEnabled(true);
				showBert();
				ctx.ui.notify("Bert is visible.", "info");
				return;
			}
			if (command === "off") {
				animator.setEnabled(false);
				hideBert();
				ctx.ui.notify("Bert is hidden. Use /bert on to bring him back.", "info");
				return;
			}
			if (command === "animate") {
				const value = requestedMode as BertAnimateSetting | undefined;
				if (value && ANIMATE_SETTINGS.includes(value)) {
					animateSetting = value;
					animator.setAnimationEnabled(shouldAnimate());
					tui?.requestRender();
					ctx.ui.notify(
						`Bert animation: ${value}${value === "auto" ? ` (currently ${shouldAnimate() ? "animating" : "static"} in this renderer)` : ""}.`,
						"info",
					);
					return;
				}
				ctx.ui.notify(`Usage: /bert animate [${ANIMATE_SETTINGS.join("|")}] (currently: ${animateSetting})`, "error");
				return;
			}
			if (command === "test" && requestedMode && MODES.includes(requestedMode as BertMode)) {
				animator.preview(requestedMode as BertMode);
				ctx.ui.notify(`Previewing Bert's ${requestedMode} state for 5 seconds.`, "info");
				return;
			}
			if (command !== "status" && command !== "") {
				ctx.ui.notify(`Usage: /bert [on|off|test ${MODES.join("|")}]`, "error");
				return;
			}

			const snapshot = animator.snapshot();
			ctx.ui.notify(
				`Bert is ${animator.isEnabled() ? "visible" : "hidden"} (${snapshot.mode}), animation ${animator.isAnimationEnabled() ? "on" : "off"} [${animateSetting}].`,
				"info",
			);
		},
	});
}
