import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeCdp } from "./helpers.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
function run(file, args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = ""; let stderr = "";
        const deadline = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Test child timed out")); }, 15000);
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (code) => { clearTimeout(deadline); resolve({ code, stdout, stderr }); });
    });
}

test("shell client cold-starts once, reuses CDP, propagates errors, and shuts down", async () => {
    const directory = mkdtempSync(join(tmpdir(), "grokbot-client-"));
    chmodSync(directory, 0o700);
    const fake = await fakeCdp();
    const config = join(directory, "config.json");
    writeFileSync(config, JSON.stringify({ bot: { agentId: "example-agent" }, app: { debugPort: fake.port }, audio: { enabled: false } }));
    const env = { ...process.env, GROKBOT_VOICE_CONFIG: config, GROKBOT_VOICE_RUNTIME: directory };
    const client = join(root, "bin/grokbot-voice-call");
    try {
        const replies = await Promise.all(Array.from({ length: 4 }, () => run(client, ["ping"], env)));
        assert.ok(replies.every((reply) => reply.code === 0), JSON.stringify(replies));
        const pid = JSON.parse(replies[0].stdout).pid;
        assert.ok(replies.every((reply) => JSON.parse(reply.stdout).pid === pid));
        const start = await run(client, ["start"], env);
        assert.equal(start.code, 0, start.stdout + start.stderr);
        assert.equal(JSON.parse(start.stdout).phase, "live");
        assert.equal(JSON.parse((await run(client, ["mute"], env)).stdout).muted, true);
        const status = await run(client, ["status"], env);
        assert.equal(JSON.parse(status.stdout).phase, "live");
        assert.equal(fake.connections, 1);
        assert.equal(fake.page.starts, 1);
        assert.equal((await run(client, ["stop"], env)).code, 0);
        writeFileSync(config, "null");
        assert.equal((await run(client, ["start"], env)).code, 1, "application errors reach the shell caller");
        assert.equal((await run(client, ["ping"], env)).code, 0);
    } finally {
        await run(client, ["shutdown"], env);
        await fake.close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("standalone installer rolls back errors, keeps user files, supports XDG and removes its own links", async () => {
    const directory = mkdtempSync(join(tmpdir(), "grokbot-install-"));
    const bin = join(directory, "tools");
    const config = join(directory, "config");
    const targetBin = join(directory, "user-bin");
    const log = join(directory, "commands.log");
    mkdirSync(bin); mkdirSync(join(config, "hypr"), { recursive: true });
    writeFileSync(join(config, "hypr/hyprland.lua"), "-- User configuration\n");
    for (const tool of ["omarchy", "omarchy-shell"]) writeFileSync(join(bin, tool), `#!/bin/bash
printf '%s\\n' "$*" >> "$INSTALL_LOG"
if [[ $* == 'shell listPlugins' ]]; then
  if [[ ! -f "$INSTALL_LOG.ready" ]]; then touch "$INSTALL_LOG.ready"; echo '[]'; else echo '[{"id":"grokbot.voice"}]'; fi
fi
if [[ $FAIL_ENABLE == 1 && $* == 'plugin enable grokbot.voice' ]]; then exit 7; fi
`, { mode: 0o755 });
    const env = { ...process.env, PATH: bin + ":" + process.env.PATH, XDG_CONFIG_HOME: config, GROKBOT_VOICE_BIN_DIR: targetBin, INSTALL_LOG: log };
    const cli = join(root, "bin/grokbot-voice");
    const plugin = join(config, "omarchy/plugins/grokbot.voice");
    try {
        assert.equal((await run(cli, ["install"], { ...env, FAIL_ENABLE: "1" })).code, 1);
        assert.equal(existsSync(plugin), false);
        assert.equal(existsSync(join(targetBin, "grokbot-voice")), false);
        const installed = await run(cli, ["install"], env);
        assert.equal(installed.code, 0, installed.stderr);
        assert.equal(readlinkSync(plugin), root.replace(/\/$/, ""));
        assert.equal((await run(cli, ["install"], env)).code, 0, "repeat install is safe");
        assert.equal((await run(cli, ["setup", "hyprland", "SUPER + grave"], env)).code, 0);
        assert.equal((await run(cli, ["setup", "hyprland", "SUPER + grave"], env)).code, 0);
        assert.equal(readFileSync(join(config, "hypr/hyprland.lua"), "utf8").match(/require/g).length, 1);
        assert.equal((await run(cli, ["uninstall"], env)).code, 0);
        assert.equal(existsSync(plugin), false);
        assert.equal(existsSync(join(root, "manifest.json")), true, "source checkout remains");
        assert.equal(readFileSync(join(config, "hypr/hyprland.lua"), "utf8"), "-- User configuration\n");
        mkdirSync(plugin);
        writeFileSync(join(plugin, "keep"), "user data");
        assert.equal((await run(cli, ["install"], env)).code, 1);
        assert.equal(readFileSync(join(plugin, "keep"), "utf8"), "user data");
        assert.match(readFileSync(log, "utf8"), /shell listPlugins/);
        assert.match(readFileSync(log, "utf8"), /plugin enable grokbot.voice/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
});
