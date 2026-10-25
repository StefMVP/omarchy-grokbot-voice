import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
const call = vm.runInNewContext(readFileSync(new URL("../lib/call.js", import.meta.url), "utf8") + "\n({initial,begin,complete,close,parseResult,duration})");

test("QML session ignores stale start, poll and close completions after cancellation", () => {
    let state = call.begin(call.initial(), "start");
    const starting = state.generation;
    state = call.begin(state, "stop");
    assert.equal(call.complete(state, "start", starting, { ok: true, phase: "live" }, 1), state);
    assert.equal(call.complete(state, "status", starting, { ok: true, phase: "live" }, 1), state);
    state = call.complete(state, "stop", state.generation, { ok: true, phase: "idle" }, 1);
    const oldTimer = state.generation;
    state = call.begin(state, "start");
    assert.equal(call.close(state, oldTimer), state);
    assert.equal(state.opened, true);
    assert.equal(state.status, "calling");
});

test("QML retains controls until hang-up is confirmed, including after a driver error", () => {
    let state = call.begin(call.initial(), "start");
    state = call.complete(state, "start", state.generation, { ok: true, phase: "live", audio: "ready" }, 100);
    state = call.begin(state, "stop");
    state = call.complete(state, "stop", state.generation, { ok: false, error: "Not confirmed" }, 100);
    assert.equal(state.opened, true);
    assert.equal(state.mayBeLive, true);
    assert.equal(call.close(state, state.generation), state);
    state = call.complete(state, "status", state.generation, { ok: true, phase: "idle" }, 100);
    assert.equal(call.close(state, state.generation).opened, false);
});

test("driver reply parsing and duration handle incomplete data", () => {
    for (const input of ["", "null", "[]", "{", "false", '{"ok":false}']) assert.equal(call.parseResult(input).ok, false);
    assert.equal(call.parseResult('{"ok":true,"audio":"unavailable"}').audio, "unavailable");
    assert.equal(call.duration(61000), "1:01");
    assert.equal(call.duration(-1), "0:00");
});
