export class Cdp {
    constructor({ port, timeout = 2000, WebSocketClass = WebSocket, fetcher = fetch }) {
        this.port = port;
        this.timeout = timeout;
        this.WebSocketClass = WebSocketClass;
        this.fetcher = fetcher;
        this.pending = new Map();
        this.nextId = 0;
        this.socket = null;
        this.connecting = null;
        this.disposed = false;
    }

    async connect() {
        if (this.disposed) throw new Error("Debug connection closed");
        if (this.connecting) return this.connecting;
        if (this.socket?.readyState === 1) return;
        this.connecting = this.open().finally(() => { this.connecting = null; });
        return this.connecting;
    }

    async open() {
        let targets;
        try {
            const response = await this.fetcher(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(this.timeout) });
            if (!response.ok) throw new Error();
            targets = await response.json();
        } catch {
            const error = new Error(`Grok Bot debug port ${this.port} is closed or did not answer; restart Grok Bot with --remote-debugging-port=${this.port}`);
            error.code = "APP_CLOSED";
            throw error;
        }
        const pages = Array.isArray(targets) ? targets.filter((target) => {
            try { return target.type === "page" && new URL(target.url).pathname.endsWith("/renderer/index.html"); }
            catch { return false; }
        }) : [];
        if (pages.length !== 1) throw new Error("Cannot identify one Grok Bot renderer");
        const url = new URL(pages[0].webSocketDebuggerUrl);
        if (url.protocol !== "ws:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || Number(url.port) !== this.port) throw new Error("Debug WebSocket must use the local app port");
        if (this.disposed) throw new Error("Debug connection closed");
        const socket = new this.WebSocketClass(url.href);
        this.socket = socket;
        await new Promise((resolve, reject) => {
            const finish = (error) => {
                clearTimeout(timer);
                socket.removeEventListener("open", opened);
                socket.removeEventListener("error", failed);
                socket.removeEventListener("close", failed);
                if (error) { this.disconnect(error); reject(error); }
                else resolve();
            };
            const opened = () => finish();
            const failed = () => finish(new Error("Debug WebSocket disconnected"));
            const timer = setTimeout(() => finish(new Error("Debug WebSocket handshake timed out")), this.timeout);
            socket.addEventListener("open", opened);
            socket.addEventListener("error", failed);
            socket.addEventListener("close", failed);
        });
        if (this.disposed) throw new Error("Debug connection closed");
        socket.addEventListener("message", (event) => this.receive(event.data));
        socket.addEventListener("close", () => { if (this.socket === socket) this.disconnect(new Error("Debug WebSocket disconnected")); });
        socket.addEventListener("error", () => { if (this.socket === socket) this.disconnect(new Error("Debug WebSocket failed")); });
        try {
            const ua = await this.evaluate("navigator.userAgent", this.timeout);
            if (typeof ua !== "string" || !/GrokBot\/[\d.]+/.test(ua)) throw new Error("Renderer is not Grok Bot");
        } catch (error) { this.disconnect(error); throw error; }
    }

    receive(data) {
        let message;
        try { message = JSON.parse(data); } catch { return; }
        const item = this.pending.get(message?.id);
        if (!item) return;
        this.pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.error || message.result?.exceptionDetails) item.reject(new Error("Grok Bot page evaluation failed"));
        else item.resolve(message.result?.result?.value);
    }

    evaluate(expression, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const socket = this.socket;
            if (!socket || socket.readyState !== 1) { reject(new Error("Debug WebSocket is closed")); return; }
            const id = ++this.nextId;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error("Grok Bot page did not answer"));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            try {
                socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: {
                    expression, returnByValue: true, awaitPromise: true, userGesture: true,
                } }));
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    disconnect(error = new Error("Debug connection closed")) {
        const socket = this.socket;
        this.socket = null;
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
        this.pending.clear();
        if (socket && socket.readyState < 2) socket.close();
    }

    close() { this.disposed = true; this.disconnect(); }
}
