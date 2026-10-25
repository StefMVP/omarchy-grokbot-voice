import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { startServer } from "../lib/server.mjs";

export function ask(path, line) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection(path);
        let data = "";
        client.setTimeout(2000, () => client.destroy(new Error("Test request timed out")));
        client.on("error", reject);
        client.on("connect", () => client.end(line + "\n"));
        client.on("data", (chunk) => { data += chunk; });
        client.on("end", () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    });
}

test("IPC rejects malformed and inherited commands, bounds input, and survives synchronous failures", async () => {
    const directory = mkdtempSync(join(tmpdir(), "grokbot-server-"));
    const server = await startServer({ command() { throw new Error("Fixture failure"); }, close() {} }, directory);
    try {
        for (const request of ["null", "[]", '"status"', "{", '{}', '{"cmd":null}', '{"cmd":"constructor"}', '{"cmd":"toString"}', "x".repeat(4097)]) {
            assert.equal((await ask(server.path, request)).ok, false, request.slice(0, 30));
        }
        assert.equal((await ask(server.path, '{"cmd":"status"}')).error, "Fixture failure");
        assert.equal((await ask(server.path, '{"cmd":"ping"}')).ok, true);
        assert.equal((await ask(server.path, '{"cmd":"ping"}\n{"cmd":"status"}')).ok, true, "one request per client");
        assert.equal(await startServer({ close() {} }, directory), null, "second daemon does not unlink the live socket");
        assert.equal((await ask(server.path, '{"cmd":"ping"}')).ok, true);
    } finally { server.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});

test("IPC stop is not queued behind an unfinished start", async () => {
    const directory = mkdtempSync(join(tmpdir(), "grokbot-server-"));
    let finish;
    let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const server = await startServer({ command(cmd) {
        if (cmd === "start") { entered(); return new Promise((resolve) => { finish = resolve; }); }
        finish({ ok: false, error: "Cancelled" }); return { ok: true };
    }, close() {} }, directory);
    try {
        const first = ask(server.path, '{"cmd":"start"}');
        await started;
        assert.equal((await ask(server.path, '{"cmd":"stop"}')).ok, true);
        assert.equal((await first).ok, false);
    } finally { server.shutdown(); rmSync(directory, { recursive: true, force: true }); }
});
