import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function configPath(env = process.env) {
    const path = env.GROKBOT_VOICE_CONFIG || join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "grokbot-voice/config.json");
    if (!isAbsolute(path)) throw new Error("The configuration path must be absolute");
    return path;
}

function object(value, label, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) throw new Error(`Unknown setting: ${label}.${key}`);
    }
    return value;
}

function integer(value, fallback, min, max, label) {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
    return value;
}

export function validateConfig(raw) {
    object(raw, "config", ["bot", "app", "audio", "call"]);
    const bot = object(raw.bot === undefined ? {} : raw.bot, "bot", ["agentId"]);
    const app = object(raw.app === undefined ? {} : raw.app, "app", ["debugPort", "processBinary"]);
    const audio = object(raw.audio === undefined ? {} : raw.audio, "audio", ["enabled", "readyTimeoutMs", "noiseFloorDb", "peakDb"]);
    const call = object(raw.call === undefined ? {} : raw.call, "call", ["position", "margin"]);
    const agentId = bot.agentId === undefined ? "" : bot.agentId;
    if (typeof agentId !== "string" || agentId.length > 256 || [...agentId].some((char) => char.charCodeAt(0) < 32)) throw new Error("bot.agentId must be a string without control characters");
    const processBinary = app.processBinary === undefined ? "grok-bot" : app.processBinary;
    if (typeof processBinary !== "string" || !processBinary || processBinary.length > 256) throw new Error("app.processBinary must be a nonempty string");
    if (audio.enabled !== undefined && typeof audio.enabled !== "boolean") throw new Error("audio.enabled must be a boolean");
    if (call.position !== undefined && !["top", "bottom"].includes(call.position)) throw new Error("call.position must be top or bottom");
    const noiseFloorDb = integer(audio.noiseFloorDb, -48, -90, -20, "audio.noiseFloorDb");
    const peakDb = integer(audio.peakDb, Math.max(-24, noiseFloorDb + 6), -36, 0, "audio.peakDb");
    if (peakDb <= noiseFloorDb) throw new Error("audio.peakDb must be above audio.noiseFloorDb");
    return {
        bot: { agentId },
        app: { debugPort: integer(app.debugPort, 9222, 1, 65535, "app.debugPort"), processBinary },
        audio: { enabled: audio.enabled ?? true, noiseFloorDb, peakDb, readyTimeoutMs: integer(audio.readyTimeoutMs, 2500, 200, 10000, "audio.readyTimeoutMs") },
        call: { position: call.position ?? "bottom", margin: integer(call.margin, 28, 0, 4096, "call.margin") },
    };
}

export function requireBot(config) {
    if (!config.bot.agentId.trim() || config.bot.agentId === "YOUR_AGENT_ID") throw new Error("Set bot.agentId in the Grok Bot Voice configuration before calling");
    return config.bot.agentId;
}

export function configStore(path = configPath()) {
    let signature;
    let cached;
    return () => {
        let current;
        try {
            const st = statSync(path);
            if (st.size > 65536) throw new Error("Configuration exceeds 64 KiB");
            current = `${st.ino}:${st.mtimeMs}:${st.ctimeMs}:${st.size}`;
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            current = "missing";
        }
        if (current !== signature) {
            let raw = {};
            if (current !== "missing") {
                try { raw = JSON.parse(readFileSync(path, "utf8")); }
                catch { throw new Error("Cannot parse Grok Bot Voice configuration JSON"); }
            }
            cached = validateConfig(raw);
            signature = current;
        }
        return cached;
    };
}
