import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectApp } from "../lib/app.mjs";

function procWith(entries) {
    const proc = mkdtempSync(join(tmpdir(), "grokbot-proc-"));
    for (const [pid, args] of Object.entries(entries)) {
        mkdirSync(join(proc, pid));
        writeFileSync(join(proc, pid, "cmdline"), args.join("\0") + "\0");
    }
    return proc;
}

test("app inspection separates the main process, helpers and the debug port", () => {
    const dirs = [
        procWith({ 1: ["/usr/bin/bash", "-c", "true"] }),
        procWith({ 2: ["/opt/Grok Bot/grok-bot", "--type=zygote"] }),
        procWith({ 3: ["/opt/Grok Bot/grok-bot", "--ozone-platform=wayland"] }),
        procWith({ 4: ["/opt/Grok Bot/grok-bot", "--remote-debugging-port=9222"] }),
        procWith({ 5: ["/opt/Grok Bot/grok-bot", "--remote-debugging-port", "9222"] }),
    ];
    try {
        assert.deepEqual(inspectApp("grok-bot", 9222, dirs[0]), { state: "absent" });
        assert.deepEqual(inspectApp("grok-bot", 9222, dirs[1]), { state: "absent" });
        assert.deepEqual(inspectApp("grok-bot", 9222, dirs[2]), { state: "missing", pid: 3 });
        assert.deepEqual(inspectApp("grok-bot", 9222, dirs[3]), { state: "ready", pid: 4 });
        assert.deepEqual(inspectApp("grok-bot", 9222, dirs[4]), { state: "ready", pid: 5 });
        assert.deepEqual(inspectApp("grok-bot", 9222, join(dirs[0], "missing")), { state: "unknown" });
    } finally {
        for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    }
});
