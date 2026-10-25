import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, configStore, requireBot, validateConfig } from "../lib/config.mjs";

test("configuration rejects invalid types, unknown keys and unconfigured bots", () => {
    for (const value of [null, [], { bot: null }, { call: { margin: "28" } }, { call: { margin: -1 } }, { call: { position: "left" } }, { audio: { enabled: "yes" } }, { app: { debugPort: 0 } }, { bot: { agentId: null } }, { debug: true }]) {
        assert.throws(() => validateConfig(value));
    }
    assert.throws(() => requireBot(validateConfig({})), /Set bot.agentId/);
    assert.throws(() => requireBot(validateConfig({ bot: { agentId: "YOUR_AGENT_ID" } })), /Set bot.agentId/);
    assert.equal(validateConfig({ call: { margin: 0 } }).call.margin, 0);
    assert.equal(configPath({ HOME: "/home/example", XDG_CONFIG_HOME: "/config" }), "/config/grokbot-voice/config.json");
    assert.equal(configPath({ GROKBOT_VOICE_CONFIG: "/private/settings.json" }), "/private/settings.json");
    assert.throws(() => configPath({ GROKBOT_VOICE_CONFIG: "relative.json" }), /absolute/);
});

test("configuration detects edits and reports invalid JSON without silently using cached settings", () => {
    const directory = mkdtempSync(join(tmpdir(), "grokbot-config-"));
    const path = join(directory, "config.json");
    try {
        const settings = configStore(path);
        assert.throws(() => requireBot(settings()), /Set bot.agentId/);
        writeFileSync(path, '{"bot":{"agentId":"example"}}');
        assert.equal(requireBot(settings()), "example");
        writeFileSync(path, "null"); assert.throws(settings, /object/);
        writeFileSync(path, "{"); assert.throws(settings, /parse/);
        writeFileSync(path, '{"call":{"margin":0}}'); assert.equal(settings().call.margin, 0);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
