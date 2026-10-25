import { JSDOM } from "jsdom";
import http from "node:http";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { installExpression } from "../lib/page.mjs";

export function app({ id = "example-agent", mark = id, initial = "idle", selectDelay = 0, startDelay = 0, ignoreStop = false } = {}) {
    const dom = new JSDOM(`<!doctype html><body><button data-agent-id aria-label="Example, bot"></button>
      <button aria-label="View conversation details">Example</button><div aria-label="Conversation transcript">Example conversation</div>
      <button aria-label="Start voice chat"></button><button aria-label="Mute"></button><button aria-label="Hang up"></button></body>`, { runScripts: "outside-only" });
    const { window } = dom;
    Object.defineProperty(window.navigator, "userAgent", { value: "GrokBot/0.75.3" });
    const row = window.document.querySelector("[data-agent-id]");
    row.setAttribute("data-agent-id", id);
    let starts = 0;
    let stops = 0;
    let observers = 0;
    const NativeObserver = window.MutationObserver;
    window.MutationObserver = class extends NativeObserver {
        observe(...args) { observers++; super.observe(...args); }
        disconnect() { observers--; super.disconnect(); }
    };
    const setPhase = (phase) => {
        window.document.querySelector("[data-voice-call-popover]")?.remove();
        if (phase === "idle") return;
        const panel = window.document.createElement("div");
        panel.setAttribute("data-voice-call-popover", "");
        panel.setAttribute("data-voice-call-phase", phase);
        if (mark !== null) {
            const use = window.document.createElement("use");
            use.setAttribute("href", "#sand-agent-mark-source-" + mark);
            panel.append(use);
        }
        window.document.body.append(panel);
    };
    row.onclick = () => {
        window.document.querySelector('[aria-label="View conversation details"]').textContent = "Loading";
        const select = () => {
            window.document.querySelector('[aria-label="View conversation details"]').textContent = "Example";
            window.document.querySelector('[aria-label="Conversation transcript"]').textContent = "Example conversation";
        };
        if (selectDelay) window.setTimeout(select, selectDelay); else select();
    };
    window.document.querySelector('[aria-label="Start voice chat"]').onclick = () => {
        starts++;
        if (startDelay) window.setTimeout(() => setPhase("live"), startDelay); else setPhase("live");
    };
    window.document.querySelector('[aria-label="Hang up"]').onclick = () => { stops++; if (!ignoreStop) setPhase("idle"); };
    window.document.querySelector('[aria-label="Mute"]').onclick = (event) => {
        const button = event.currentTarget;
        button.setAttribute("aria-label", button.getAttribute("aria-label") === "Mute" ? "Unmute" : "Mute");
    };
    setPhase(initial);
    window.eval(installExpression);
    return { window, setPhase, call: (...args) => window.__grokbotVoice.call(...args), close: () => window.close(),
        get starts() { return starts; }, get stops() { return stops; }, get observers() { return observers; } };
}

export async function fakeCdp(page = app()) {
    let connections = 0;
    let evaluations = 0;
    const sockets = new Set();
    const wss = new WebSocketServer({ noServer: true });
    const server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([{ type: "page", url: "file:///app/renderer/index.html", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/page` }]));
    });
    server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
    wss.on("connection", (ws) => {
        connections++; sockets.add(ws); ws.on("close", () => sockets.delete(ws));
        ws.on("message", async (data) => {
            const message = JSON.parse(data);
            evaluations++;
            try {
                const value = await page.window.eval(message.params.expression);
                if (ws.readyState === 1) ws.send(JSON.stringify({ id: message.id, result: { result: { value } } }));
            } catch {
                if (ws.readyState === 1) ws.send(JSON.stringify({ id: message.id, result: { exceptionDetails: {} } }));
            }
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { port: server.address().port, page, get connections() { return connections; }, get evaluations() { return evaluations; },
        disconnect() { for (const ws of sockets) ws.terminate(); },
        async close() { page.close(); for (const ws of sockets) ws.terminate(); wss.close(); await new Promise((resolve) => server.close(resolve)); } };
}
