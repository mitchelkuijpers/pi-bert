import assert from "node:assert/strict";
import test from "node:test";
import {
	DONE_HOLD_MS,
	ERROR_HOLD_MS,
	LONG_OPERATION_MS,
	selectVisual,
	type BertActivityState,
} from "../extensions/state.ts";

function idleState(): BertActivityState {
	return {
		activeTools: [],
		waiting: false,
		compacting: false,
		errorUntil: 0,
		doneUntil: 0,
	};
}

test("Bert is neutral while idle", () => {
	const visual = selectVisual(idleState(), 1_000);
	assert.equal(visual.mode, "idle");
	assert.equal(visual.pose, "neutral");
	assert.equal(visual.staticMouth, "closed");
});

test("tool activity uses the gesturing pose and names the latest tool", () => {
	const state = idleState();
	state.agentStartedAt = 1_000;
	state.activeTools = ["read", "bash"];
	const visual = selectVisual(state, 2_000);
	assert.equal(visual.mode, "tool");
	assert.equal(visual.pose, "gesturing");
	assert.match(visual.caption, /bash/);
});

test("a long agent run becomes tired even while a tool is active", () => {
	const state = idleState();
	state.agentStartedAt = 1_000;
	state.activeTools = ["bash"];
	assert.equal(selectVisual(state, 1_000 + LONG_OPERATION_MS - 1).mode, "tool");
	assert.equal(selectVisual(state, 1_000 + LONG_OPERATION_MS).mode, "tired");
});

test("errors override waiting, tools, and tired state until their deadline", () => {
	const now = 50_000;
	const state = idleState();
	state.agentStartedAt = 1_000;
	state.activeTools = ["edit"];
	state.waiting = true;
	state.errorTool = "edit";
	state.errorUntil = now + ERROR_HOLD_MS;
	assert.equal(selectVisual(state, now).mode, "error");
	assert.match(selectVisual(state, now).caption, /edit/);
	assert.equal(selectVisual(state, now + ERROR_HOLD_MS).mode, "waiting");
});

test("done expires back to idle", () => {
	const now = 10_000;
	const state = idleState();
	state.doneUntil = now + DONE_HOLD_MS;
	assert.equal(selectVisual(state, now).mode, "done");
	assert.equal(selectVisual(state, now + DONE_HOLD_MS).mode, "idle");
});

test("preview has the highest priority", () => {
	const now = 25_000;
	const state = idleState();
	state.errorUntil = now + ERROR_HOLD_MS;
	state.preview = { mode: "done", until: now + 1_000 };
	assert.equal(selectVisual(state, now).mode, "done");
	assert.equal(selectVisual(state, now + 1_000).mode, "error");
});
