import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { inspectApp } from "./app.mjs";
import { configStore } from "./config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const expected = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
const run = (tool, args, timeout = 5000) => execFileSync(tool, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] }).trim();
const version = () => {
    try { return run("omarchy-shell", ["grokbot.voice", "version"]); }
    catch { return ""; }
};
function doctorReply() {
    const call = root + "bin/grokbot-voice-call";
    try { return JSON.parse(run(call, ["doctor"])); }
    catch (error) {
        try { return JSON.parse(String(error.stdout || "").trim()); } catch { throw error; }
    }
}
function advice() {
    let settings;
    try { settings = configStore()(); } catch { return ""; }
    const found = inspectApp(settings.app.processBinary, settings.app.debugPort);
    if (found.state === "missing") return `Grok Bot is running without --remote-debugging-port=${settings.app.debugPort}. Restart Grok Bot.`;
    if (found.state === "absent") return "Grok Bot is not running.";
    return "";
}

try {
    const command = process.argv[2];
    if (command === "reload") {
        const state = JSON.parse(run("omarchy-shell", ["grokbot.voice", "state"]));
        const app = JSON.parse(run(root + "bin/grokbot-voice-call", ["status"]));
        if (state.mayBeLive || !app.ok || !["idle", "ended"].includes(app.phase)) throw new Error("End the call before reloading");
        run(root + "bin/grokbot-voice-call", ["shutdown"]);
        run("omarchy", ["restart", "shell"], 90000);
        const deadline = Date.now() + 15000;
        while (version() !== expected && Date.now() < deadline) await delay(100);
    } else if (command !== "doctor") throw new Error("Expected doctor or reload");
    if (version() !== expected) throw new Error("Loaded plugin is stale. Run grokbot-voice reload");
    console.log("Loaded Grok Bot Voice " + expected);
    if (command === "doctor") {
        console.log(run("omarchy", ["plugin", "validate", root]));
        const reply = doctorReply();
        if (reply.ok) console.log(JSON.stringify(reply));
        else {
            console.error(reply.error || "Grok Bot did not answer");
            const hint = advice();
            if (hint) console.error(hint);
            process.exitCode = 1;
        }
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
