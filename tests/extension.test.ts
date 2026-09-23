import assert from "node:assert/strict";
import test from "node:test";
import bertExtension from "../extensions/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

test("Bert removes its overlay when disabled and recreates it when enabled", async () => {
	const eventHandlers = new Map<string, (...args: any[]) => unknown>();
	let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;
	let widgetFactory: ((tui: any, theme: any) => any) | undefined;
	let overlaysShown = 0;
	let overlaysHidden = 0;
	let renderRequests = 0;
	const tui = {
		terminal: { columns: 100 },
		requestRender: () => renderRequests++,
		showOverlay: () => {
			overlaysShown++;
			return { hide: () => overlaysHidden++ };
		},
	};
	const theme = { fg: (_color: string, text: string) => text };
	const ui = {
		setWidget: (_key: string, content: any) => {
			widgetFactory = content;
		},
		notify: () => {},
	};
	const pi = {
		on: (name: string, handler: (...args: any[]) => unknown) => eventHandlers.set(name, handler),
		registerCommand: (_name: string, options: { handler: typeof commandHandler }) => {
			commandHandler = options.handler;
		},
	};

	bertExtension(pi as unknown as ExtensionAPI);
	eventHandlers.get("session_start")?.({}, { mode: "tui", ui });
	assert.ok(widgetFactory);
	assert.ok(commandHandler);
	const widget = widgetFactory(tui, theme);
	assert.equal(overlaysShown, 1);
	assert.deepEqual(widget.render(100), []);
	assert.deepEqual(widget.render(40), []);

	await commandHandler("off", { mode: "tui", ui });
	assert.equal(overlaysHidden, 1);
	await commandHandler("on", { mode: "tui", ui });
	assert.equal(overlaysShown, 2);
	assert.ok(renderRequests > 0);

	eventHandlers.get("session_shutdown")?.({}, { ui });
	assert.equal(overlaysHidden, 2);
});
