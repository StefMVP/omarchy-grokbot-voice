import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { Cdp } from "../lib/cdp.mjs";
import { fakeCdp } from "./helpers.mjs";

test("CDP shares one connection, cleans timed-out requests and rejects pending work on disconnect", async () => {
    const fake = await fakeCdp();
    const cdp = new Cdp({ port: fake.port });
    try {
        await Promise.all([cdp.connect(), cdp.connect()]);
        assert.equal(fake.connections, 1);
        assert.equal(await cdp.evaluate("2 + 3"), 5);
        const socket = cdp.socket;
        const listeners = getEventListeners(socket, "message").length;
        await assert.rejects(cdp.evaluate("new Promise(() => {})", 20), /did not answer/);
        assert.equal(cdp.pending.size, 0);
        assert.equal(getEventListeners(socket, "message").length, listeners);
        const pending = cdp.evaluate("new Promise(() => {})");
        fake.disconnect();
        await assert.rejects(pending, /disconnected|failed/);
        assert.equal(cdp.pending.size, 0);
        await cdp.connect();
        assert.equal(await cdp.evaluate("6"), 6);
        assert.equal(fake.connections, 2);
    } finally { cdp.close(); await fake.close(); }
});

test("CDP refuses unrelated and ambiguous renderer targets", async () => {
    for (const targets of [[{ type: "page", url: "https://example.invalid" }], [1, 2].map(() => ({ type: "page", url: "file:///app/renderer/index.html" }))]) {
        const cdp = new Cdp({ port: 9222, fetcher: async () => ({ ok: true, json: async () => targets }) });
        await assert.rejects(cdp.connect(), /one Grok Bot renderer/);
        cdp.close();
    }
});

test("WebSocket handshakes have a deadline", async () => {
    class Stalled extends EventTarget {
        readyState = 0;
        close() { this.readyState = 3; }
    }
    const cdp = new Cdp({ port: 9222, timeout: 20, WebSocketClass: Stalled, fetcher: async () => ({ ok: true, json: async () => [{ type: "page", url: "file:///app/renderer/index.html", webSocketDebuggerUrl: "ws://127.0.0.1:9222/page" }] }) });
    await assert.rejects(cdp.connect(), /handshake timed out/);
    assert.equal(cdp.socket, null);
    cdp.close();
});
