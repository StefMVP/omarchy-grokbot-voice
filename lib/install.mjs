import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = process.env.HOME || homedir();
const config = process.env.XDG_CONFIG_HOME || join(home, ".config");
const bin = process.env.GROKBOT_VOICE_BIN_DIR || join(home, ".local/bin");
const plugins = join(config, "omarchy/plugins");
const plugin = join(plugins, "grokbot.voice");
const cli = join(bin, "grokbot-voice");
const hypr = join(config, "hypr");
const module = join(hypr, "grokbot-voice.lua");
const main = join(hypr, "hyprland.lua");
const requireLine = 'require("hypr.grokbot-voice")';
const header = "-- Managed by grokbot-voice.\n";
const run = (tool, args) => execFileSync(tool, args, { stdio: "inherit", timeout: 10000 });
const stat = (path) => { try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const matches = (path, target) => stat(path)?.isSymbolicLink() && resolve(dirname(path), readlinkSync(path)) === target;

async function waitForPlugin() {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
        const output = execFileSync("omarchy-shell", ["shell", "listPlugins"], { encoding: "utf8", timeout: 2000 });
        const plugins = JSON.parse(output);
        if (Array.isArray(plugins) && plugins.some((plugin) => plugin.id === "grokbot.voice")) return;
        await delay(50);
    }
    throw new Error("Omarchy did not discover Grok Bot Voice");
}

async function install() {
    const links = [[plugin, root], [cli, join(root, "bin/grokbot-voice")]];
    for (const [path, target] of links) {
        if (stat(path) && path !== root && !matches(path, target)) throw new Error(`Path already exists: ${path}`);
    }
    run("omarchy", ["plugin", "validate", root]);
    const created = [];
    try {
        for (const [path, target] of links) {
            if (path === root || matches(path, target)) continue;
            mkdirSync(dirname(path), { recursive: true });
            symlinkSync(target, path); created.push(path);
        }
        run("omarchy-shell", ["shell", "rescanPlugins"]);
        await waitForPlugin();
        run("omarchy", ["plugin", "enable", "grokbot.voice"]);
    } catch (error) {
        for (const path of created.reverse()) unlinkSync(path);
        throw error;
    }
    console.log("Installed Grok Bot Voice");
}
function setup(key) {
    if (!key || !/^[A-Za-z0-9_ +]+$/.test(key)) throw new Error("Supply a Hyprland key, for example 'SUPER + grave'");
    if (!existsSync(main)) throw new Error("Hyprland Lua configuration is missing");
    if (stat(module) && !readFileSync(module, "utf8").startsWith(header)) throw new Error("Hotkey file is not managed by this plugin");
    writeFileSync(module, `${header}hl.unbind(${JSON.stringify(key)})\no.bind(${JSON.stringify(key)}, "Grok Bot voice call", "omarchy-shell grokbot.voice talk")\n`);
    const source = readFileSync(main, "utf8");
    if (!source.split("\n").some((line) => line.trim() === requireLine)) writeFileSync(main, source.trimEnd() + "\n" + requireLine + "\n");
    console.log("Hotkey saved. Run hyprctl reload and hyprctl configerrors.");
}
function uninstall() {
    run("omarchy", ["plugin", "disable", "grokbot.voice"]);
    for (const [path, target] of [[plugin, root], [cli, join(root, "bin/grokbot-voice")]]) {
        if (matches(path, target)) unlinkSync(path);
    }
    if (stat(module) && readFileSync(module, "utf8").startsWith(header)) {
        if (existsSync(main)) writeFileSync(main, readFileSync(main, "utf8").split("\n").filter((line) => line.trim() !== requireLine).join("\n"));
        unlinkSync(module);
    }
    run("omarchy-shell", ["shell", "rescanPlugins"]);
    console.log("Removed plugin links. Source and settings remain.");
}
try {
    for (const path of [config, bin]) if (!isAbsolute(path)) throw new Error("Installation paths must be absolute");
    const [command, topic, key, ...rest] = process.argv.slice(2);
    if (command === "install" && !topic) await install();
    else if (command === "uninstall" && !topic) uninstall();
    else if (command === "setup" && topic === "hyprland" && !rest.length) setup(key);
    else throw new Error("Invalid installation command; run grokbot-voice --help");
} catch (error) { console.error(error.message); process.exitCode = 1; }
