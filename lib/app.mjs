import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export function inspectApp(binary, port, proc = "/proc") {
    let pids;
    try { pids = readdirSync(proc); } catch { return { state: "unknown" }; }
    for (const pid of pids) {
        if (!/^\d+$/.test(pid)) continue;
        let args;
        try { args = readFileSync(join(proc, pid, "cmdline"), "utf8").split("\0"); } catch { continue; }
        if (!args[0] || basename(args[0]) !== binary) continue;
        if (args.some((arg) => arg.startsWith("--type="))) continue;
        const pair = args.some((arg, index) => arg === "--remote-debugging-port" && args[index + 1] === String(port));
        if (pair || args.includes(`--remote-debugging-port=${port}`)) return { state: "ready", pid: Number(pid) };
        return { state: "missing", pid: Number(pid) };
    }
    return { state: "absent" };
}
