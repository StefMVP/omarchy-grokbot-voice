import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
const call = vm.runInNewContext(readFileSync(new URL("../lib/call.js", import.meta.url), "utf8") + "\n({initial,begin,complete,parseResult,duration,voiceLevel})");

test("QML session ignores stale start, poll and stop completions after cancellation", () => {
    let state = call.begin(call.initial(), "start");
    const starting = state.generation;
    state = call.begin(state, "stop");
    assert.equal(call.complete(state, "start", starting, { ok: true, phase: "live" }, 1), state);
    assert.equal(call.complete(state, "status", starting, { ok: true, phase: "live" }, 1), state);
    state = call.complete(state, "stop", state.generation, { ok: true, phase: "idle" }, 1);
    assert.equal(state.opened, false);
    assert.equal(state.mayBeLive, false);
    const stopped = state.generation;
    state = call.begin(state, "start");
    assert.equal(call.complete(state, "stop", stopped, { ok: true, phase: "idle" }, 2), state);
    assert.equal(state.opened, true);
    assert.equal(state.status, "calling");
});

test("QML hides immediately on hang-up and restores controls only when stop fails", () => {
    let state = call.begin(call.initial(), "start");
    state = call.complete(state, "start", state.generation, { ok: true, phase: "live", audio: "ready" }, 100);
    state = call.begin(state, "stop");
    assert.equal(state.opened, false);
    assert.equal(state.mayBeLive, true);
    assert.equal(call.complete(state, "status", state.generation, { ok: true, phase: "live" }, 100), state);
    state = call.complete(state, "stop", state.generation, { ok: false, error: "Not confirmed" }, 100);
    assert.equal(state.opened, true);
    assert.equal(state.mayBeLive, true);
    assert.equal(state.status, "error");
    state = call.complete(state, "status", state.generation, { ok: true, phase: "idle" }, 100);
    assert.equal(state.opened, false);
    assert.equal(state.mayBeLive, false);
});

test("QML closes the pill when Grok Bot is stopped or gone", () => {
    let state = call.begin(call.initial(), "start");
    state = call.complete(state, "start", state.generation, { ok: true, phase: "live" }, 100);
    state = call.begin(state, "stop");
    state = call.complete(state, "stop", state.generation, { ok: false, appClosed: true, error: "Debug port is closed" }, 100);
    assert.equal(state.opened, false);
    assert.equal(state.status, "idle");
    assert.equal(state.mayBeLive, false);
    assert.equal(state.error, "");
    state = call.begin(state, "start");
    state = call.complete(state, "start", state.generation, { ok: false, appClosed: true, error: "Debug port is closed" }, 100);
    assert.equal(state.opened, false);
    assert.equal(state.mayBeLive, false);
    state = call.begin(state, "start");
    state = call.complete(state, "start", state.generation, { ok: true, phase: "live" }, 100);
    state = call.begin(state, "stop");
    state = call.complete(state, "stop", state.generation, { ok: false, error: "Hang-up was not confirmed" }, 100);
    assert.equal(state.opened, true);
    state = call.complete(state, "status", state.generation, { ok: false, appClosed: true, error: "Debug port is closed" }, 100);
    assert.equal(state.opened, false);
    assert.equal(state.mayBeLive, false);
});

test("driver reply parsing and duration handle incomplete data", () => {
    for (const input of ["", "null", "[]", "{", "false", '{"ok":false}']) assert.equal(call.parseResult(input).ok, false);
    assert.equal(call.parseResult('{"ok":true,"audio":"unavailable"}').audio, "unavailable");
    assert.equal(call.parseResult('{"ok":false,"appClosed":true,"error":"Debug port is closed"}').appClosed, true);
    assert.equal(call.parseResult('{"ok":false,"appClosed":"yes"}').appClosed, false);
    assert.equal(call.duration(61000), "1:01");
    assert.equal(call.duration(-1), "0:00");
});

test("voice level rejects silence and background noise, tracks loudness and stays bounded", () => {
    const peak = (db) => Math.pow(10, db / 60);
    for (const value of [0, -1, NaN, Infinity, peak(-60)]) assert.equal(call.voiceLevel(value, -48, -24), 0);
    assert.ok(call.voiceLevel(peak(-48), -48, -24) < 1e-12);
    const quiet = call.voiceLevel(peak(-36), -48, -24);
    const speech = call.voiceLevel(peak(-27), -48, -24);
    assert.ok(quiet > 0.4 && speech > quiet && speech < 1);
    assert.ok(call.voiceLevel(peak(-24), -48, -24) > 1 - 1e-12);
    assert.equal(call.voiceLevel(2, -48, -24), 1);
    assert.equal(call.voiceLevel(peak(-36), -30, -24), 0);
});
