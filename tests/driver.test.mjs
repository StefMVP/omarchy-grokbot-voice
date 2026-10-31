import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { Driver } from "../lib/driver.mjs";
import { validateConfig } from "../lib/config.mjs";
import { fakeCdp, app } from "./helpers.mjs";

test("driver requires a bot, keeps warm status to one evaluation and restores its adapter after navigation", async () => {
    const fake = await fakeCdp();
    let config = validateConfig({ app: { debugPort: fake.port }, audio: { enabled: false } });
    const driver = new Driver(() => config);
    try {
        await assert.rejects(driver.command("start"), /Set bot.agentId/);
        assert.equal(fake.connections, 0);
        config = validateConfig({ bot: { agentId: "example-agent" }, app: { debugPort: fake.port }, audio: { enabled: false } });
        assert.equal((await driver.command("doctor")).ok, true);
        const evaluations = fake.evaluations;
        assert.equal((await driver.command("status")).phase, "idle");
        assert.equal(fake.evaluations - evaluations, 1);
        fake.page.window.eval("delete globalThis.__grokbotVoice");
        assert.equal((await driver.command("status")).phase, "idle");
        assert.equal(fake.connections, 1);
        assert.equal((await driver.command("start")).phase, "live");
        assert.equal((await driver.command("stop")).phase, "idle");
    } finally { driver.close(); await fake.close(); }
});

test("invalid config edits do not prevent stop through the last valid app connection", async () => {
    const fake = await fakeCdp();
    const config = validateConfig({ bot: { agentId: "example-agent" }, app: { debugPort: fake.port }, audio: { enabled: false } });
    let invalid = false;
    const driver = new Driver(() => { if (invalid) throw new Error("Bad config fixture"); return config; });
    try {
        assert.equal((await driver.command("start")).phase, "live");
        invalid = true;
        await assert.rejects(driver.command("status"), /Bad config/);
        assert.equal((await driver.command("stop")).phase, "idle");
        assert.equal(fake.page.stops, 1);
    } finally { driver.close(); await fake.close(); }
});

test("driver reports a closed app so the pill can go away", async () => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const driver = new Driver(() => validateConfig({ bot: { agentId: "example-agent" }, app: { debugPort: port }, audio: { enabled: false } }));
    try {
        const status = await driver.command("status");
        assert.equal(status.ok, false);
        assert.equal(status.appClosed, true);
        assert.match(status.error, /debug port/);
        assert.equal((await driver.command("stop")).appClosed, true);
        await assert.rejects(driver.command("doctor"), /debug port/);
    } finally { driver.close(); }
});

test("driver stop cancels a pending start across the shared CDP connection", async () => {
    const page = app({ startDelay: 100 });
    const fake = await fakeCdp(page);
    const driver = new Driver(() => validateConfig({ bot: { agentId: "example-agent" }, app: { debugPort: fake.port }, audio: { enabled: false } }));
    try {
        const clicked = new Promise((resolve) => page.window.document.querySelector('[aria-label="Start voice chat"]').addEventListener("click", resolve, { once: true }));
        const starting = driver.command("start");
        await clicked;
        const stopping = driver.command("stop");
        assert.equal((await starting).ok, false);
        assert.equal((await stopping).phase, "idle");
        assert.equal(fake.connections, 1);
    } finally { driver.close(); await fake.close(); }
});
