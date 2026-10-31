import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "./helpers.mjs";

test("real DOM controls select the configured bot, start, mute and confirm stop", async () => {
    const id = `example'agent"[x]`;
    const page = app({ id });
    try {
        assert.equal((await page.call("start", id, 1)).phase, "live");
        assert.equal(page.starts, 1);
        assert.equal((await page.call("start", id, 2)).ok, true);
        assert.equal(page.starts, 1, "an already live call is checked without redialling");
        assert.equal((await page.call("mute", id, 2)).muted, true);
        assert.equal((await page.call("stop", id, 3)).phase, "idle");
        assert.equal(page.stops, 1);
        assert.equal(page.observers, 0, "bounded waits leave no observers");
    } finally { page.close(); }
});

test("bot selection is confirmed by the conversation header, not the transcript text", async () => {
    const page = app({ transcript: "You: hello\nExample: hi" });
    try {
        assert.equal((await page.call("start", "example-agent", 1)).phase, "live");
        assert.equal(page.starts, 1);
    } finally { page.close(); }
});

for (const initial of ["idle", "live"]) for (const mark of [null, "other-agent"]) {
    test(`identity is required on ${initial} calls with mark ${mark}`, async () => {
        const page = app({ initial, mark });
        try {
            const result = await page.call("start", "example-agent", 1);
            assert.equal(result.ok, false);
            assert.match(result.error, /identity.*hang-up confirmed/);
            assert.equal(page.stops, 1);
            assert.equal((await page.call("status", "", 1)).phase, "idle");
        } finally { page.close(); }
    });
}

test("stop cancels selection before a delayed start can click", async () => {
    const page = app({ selectDelay: 100 });
    try {
        const starting = page.call("start", "example-agent", 1);
        assert.equal((await page.call("stop", "", 2)).ok, true);
        assert.match((await starting).error, /cancelled/);
        await new Promise((resolve) => page.window.setTimeout(resolve, 140));
        assert.equal(page.starts, 0);
        assert.equal(page.observers, 0);
    } finally { page.close(); }
});

test("stop waits for an in-flight app start and confirms teardown", async () => {
    const page = app({ startDelay: 120 });
    try {
        const starting = page.call("start", "example-agent", 1);
        await new Promise((resolve) => page.window.document.querySelector('[aria-label="Start voice chat"]').addEventListener("click", resolve, { once: true }));
        const stopping = page.call("stop", "", 2);
        assert.match((await starting).error, /cancelled/);
        assert.equal((await stopping).phase, "idle");
        assert.equal(page.stops, 1);
        assert.equal(page.observers, 0);
    } finally { page.close(); }
});

test("failed hang-up does not claim success", async () => {
    const page = app({ initial: "live", ignoreStop: true });
    try {
        const result = await page.call("stop", "", 1);
        assert.equal(result.ok, false);
        assert.match(result.error, /not confirmed/);
        assert.equal((await page.call("status", "", 1)).phase, "live");
        assert.equal(page.window.getComputedStyle(page.window.document.querySelector("[data-voice-call-popover]")).visibility, "visible");
        assert.equal(page.observers, 0);
    } finally { page.close(); }
});

test("hang-up hides native controls while teardown is pending", async () => {
    const page = app({ initial: "live", stopDelay: 100 });
    try {
        const panel = page.window.document.querySelector("[data-voice-call-popover]");
        const stopping = page.call("stop", "", 1);
        assert.equal(page.window.getComputedStyle(panel).visibility, "hidden");
        assert.equal((await page.call("status", "", 1)).phase, "live");
        assert.equal((await stopping).phase, "idle");
        assert.equal(page.window.document.documentElement.hasAttribute("data-grokbot-voice-closing"), false);
    } finally { page.close(); }
});
