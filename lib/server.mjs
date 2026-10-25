import net from "node:net";
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const COMMANDS = new Set(["ping", "settings", "start", "stop", "status", "select", "mute", "doctor", "shutdown"]);
const MAX_REQUEST = 4096;

export function runtimeDir(env = process.env) {
    return env.GROKBOT_VOICE_RUNTIME || (env.XDG_RUNTIME_DIR ? join(env.XDG_RUNTIME_DIR, "grokbot-voice") : `/tmp/grokbot-voice-${process.getuid()}`);
}

async function stale(path) {
    return new Promise((resolve, reject) => {
        const probe = net.createConnection(path);
        probe.setTimeout(1000);
        probe.once("connect", () => { probe.destroy(); resolve(false); });
        probe.once("timeout", () => { probe.destroy(); reject(new Error("Existing daemon socket did not answer")); });
        probe.once("error", (error) => {
            if (["ECONNREFUSED", "ENOENT"].includes(error.code)) resolve(true);
            else reject(error);
        });
    });
}

export async function startServer(driver, directory = runtimeDir()) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || dir.uid !== process.getuid() || (dir.mode & 0o077)) throw new Error("Runtime directory must be owned by you with mode 0700");
    const path = join(directory, "call.sock");
    try {
        const before = lstatSync(path);
        if (!before.isSocket() || before.uid !== process.getuid()) throw new Error("Unsafe daemon socket path");
        if (!(await stale(path))) { driver.close(); return null; }
        const after = lstatSync(path);
        if (before.ino !== after.ino) throw new Error("Daemon socket changed during startup");
        unlinkSync(path);
    } catch (error) { if (error.code !== "ENOENT") throw error; }

    const clients = new Set();
    let lastUsed = Date.now();
    let stopped = false;
    const socketIdentity = { inode: null };
    const shutdown = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(idle);
        process.removeListener("SIGTERM", shutdown);
        process.removeListener("SIGINT", shutdown);
        driver.close();
        server.close();
        for (const client of clients) client.end();
        try { if (lstatSync(path).ino === socketIdentity.inode) unlinkSync(path); } catch (error) { if (error.code !== "ENOENT") console.error(error.message); }
    };
    const server = net.createServer({ allowHalfOpen: true }, (client) => {
        clients.add(client);
        client.on("close", () => clients.delete(client));
        client.on("error", () => {});
        client.setTimeout(12000, () => client.destroy());
        let buffer = "";
        let accepted = false;
        const reply = (payload) => { if (!client.destroyed) client.end(JSON.stringify(payload) + "\n"); };
        client.setEncoding("utf8");
        client.on("data", (chunk) => {
            if (accepted) return;
            buffer += chunk;
            if (Buffer.byteLength(buffer) > MAX_REQUEST) {
                accepted = true; reply({ ok: false, error: "Request exceeds 4096 bytes" }); return;
            }
            const newline = buffer.indexOf("\n");
            if (newline < 0) return;
            accepted = true;
            let request;
            try {
                request = JSON.parse(buffer.slice(0, newline));
                if (!request || typeof request !== "object" || Array.isArray(request) || typeof request.cmd !== "string") throw new Error();
            } catch { reply({ ok: false, error: "Invalid request object" }); return; }
            if (!COMMANDS.has(request.cmd)) { reply({ ok: false, error: "Unknown command" }); return; }
            lastUsed = Date.now();
            if (request.cmd === "ping") { reply({ ok: true, pid: process.pid }); return; }
            if (request.cmd === "shutdown") { reply({ ok: true }); shutdown(); return; }
            Promise.resolve().then(() => driver.command(request.cmd))
                .then(reply, (error) => reply({ ok: false, error: error.message || "Call failed" }));
        });
    });
    const idle = setInterval(() => { if (!clients.size && Date.now() - lastUsed > 20 * 60 * 1000) shutdown(); }, 60000);
    idle.unref();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => { server.removeListener("error", reject); resolve(); });
    }).catch((error) => { clearInterval(idle); throw error; });
    socketIdentity.inode = lstatSync(path).ino;
    chmodSync(path, 0o600);
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    return { server, shutdown, path };
}
