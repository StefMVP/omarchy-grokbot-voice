import { Cdp } from "./cdp.mjs";
import { AudioReadiness } from "./audio.mjs";
import { callExpression, installExpression } from "./page.mjs";
import { requireBot } from "./config.mjs";

export class Driver {
    constructor(settings) {
        this.settings = settings;
        this.generation = 0;
        this.audio = new AudioReadiness();
        this.connection = null;
        this.installed = null;
        this.installing = null;
    }
    async ready(config) {
        if (this.connection && this.connection.port !== config.app.debugPort) {
            this.connection.close(); this.connection = null; this.installed = null; this.audio.reset();
        }
        this.connection ??= new Cdp({ port: config.app.debugPort });
        const connection = this.connection;
        await connection.connect();
        if (this.installed !== connection.socket) {
            if (!this.installing) {
                this.installing = connection.evaluate(installExpression).then(() => { this.installed = connection.socket; }).finally(() => { this.installing = null; });
            }
            await this.installing;
        }
        return connection;
    }
    async command(command) {
        const mutating = ["start", "stop", "select"].includes(command);
        const token = mutating ? ++this.generation : this.generation;
        if (command === "stop") this.audio.reset();
        let config;
        try { config = this.settings(); }
        catch (error) {
            if (command !== "stop" || !this.lastConfig) throw error;
            config = this.lastConfig;
        }
        this.lastConfig = config;
        if (command === "settings") return { ok: true, call: config.call, audio: config.audio, processBinary: config.app.processBinary };
        if (["start", "select", "doctor"].includes(command)) requireBot(config);
        const connection = await this.ready(config);
        if (mutating && token !== this.generation) return { ok: false, error: "Call operation cancelled" };
        let value = await connection.evaluate(callExpression(command, config.bot.agentId, token));
        if (value?.adapterMissing) {
            this.installed = null;
            await this.ready(config);
            if (mutating && token !== this.generation) return { ok: false, error: "Call operation cancelled" };
            value = await connection.evaluate(callExpression(command, config.bot.agentId, token));
        }
        if (mutating && token !== this.generation) return { ok: false, error: "Call operation cancelled" };
        if (!value || typeof value !== "object" || typeof value.ok !== "boolean") throw new Error("Invalid reply from Grok Bot");
        if (command === "start" && value.ok) this.audio.start(config);
        if (command === "status" && !["idle", "ended"].includes(value.phase) && this.audio.state === "disabled" && config.audio.enabled) this.audio.start(config);
        return { ...value, audio: this.audio.state };
    }
    close() { this.generation++; this.connection?.close(); this.connection = null; this.installed = null; this.audio.reset(); }
}
