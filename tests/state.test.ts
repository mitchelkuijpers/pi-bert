import assert from "node:assert/strict";
import test from "node:test";
import {
	BertAnimator,
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

test("animator animates the mouth cycle for animated modes", () => {
	const animator = new BertAnimator();
	animator.startAgent(1_000);
	const first = animator.snapshot(1_000).mouth;
	animator["mouthIndex"] = 3;
	const later = animator.snapshot(1_000).mouth;
	assert.notEqual(first, later);
	assert.equal(animator.snapshot(1_000).mode, "thinking");
	animator.stop();
});

test("disabling animation pins the static mouth even for animated modes", () => {
	const animator = new BertAnimator();
	animator.startAgent(1_000);
	animator.setAnimationEnabled(false);
	animator["mouthIndex"] = 3;
	assert.equal(animator.snapshot(1_000).mode, "thinking");
	assert.equal(animator.snapshot(1_000).mouth, "closed");
	animator.stop();
});

test("disabling animation stops emitting on ticks but still emits on mode changes", () => {
	const animator = new BertAnimator();
	let emits = 0;
	animator.subscribe(() => emits++);
	animator.setAnimationEnabled(false);
	emits = 0;
	animator.startAgent(1_000);
	assert.equal(emits, 1); // the state change itself emits
	emits = 0;
	animator["tick"]();
	assert.equal(emits, 0); // no per-tick emission while animation is off
	animator.settleAgent(2_000);
	assert.equal(emits, 1); // mode change still notifies
	animator.stop();
});

test("setAnimationEnabled is a no-op when the value is unchanged", () => {
	const animator = new BertAnimator();
	let emits = 0;
	animator.subscribe(() => emits++);
	animator.setAnimationEnabled(true);
	assert.equal(emits, 0);
	animator.setAnimationEnabled(false);
	assert.equal(emits, 1);
	animator.setAnimationEnabled(false);
	assert.equal(emits, 1);
	animator.stop();
});
