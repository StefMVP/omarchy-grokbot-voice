import assert from "node:assert/strict";
import { test } from "node:test";
import { AudioReadiness } from "../lib/audio.mjs";

test("missing audio tooling reports unavailable and old probes cannot update a new call", async () => {
    const config = { app: { processBinary: "example" }, audio: { enabled: true, readyTimeoutMs: 200 } };
    const broken = new AudioReadiness(async () => { throw new Error("pw-dump missing"); });
    broken.start(config);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(broken.state, "unavailable");
    let finish;
    const audio = new AudioReadiness(() => new Promise((resolve) => { finish = resolve; }));
    audio.start(config);
    audio.reset();
    finish(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(audio.state, "disabled");
    audio.start({ ...config, audio: { enabled: false } });
    assert.equal(audio.state, "disabled");
});
