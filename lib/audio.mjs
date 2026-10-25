import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

export class AudioReadiness {
    constructor(probe = async (binary) => {
        const { stdout } = await run("pw-dump", [], { timeout: 800, maxBuffer: 16 * 1024 * 1024 });
        const streams = JSON.parse(stdout).filter((item) => item.type === "PipeWire:Interface:Node")
            .map((item) => item.info?.props || {})
            .filter((props) => props["application.process.binary"] === binary);
        return ["Stream/Input/Audio", "Stream/Output/Audio"].every((kind) => streams.some((props) => props["media.class"] === kind));
    }) { this.probe = probe; this.reset(); }
    reset() { this.generation = (this.generation || 0) + 1; this.state = "disabled"; }
    start(config) {
        this.reset();
        if (!config.audio.enabled) return;
        this.state = "pending";
        void this.confirm(config, this.generation);
    }
    async confirm(config, token) {
        const deadline = Date.now() + config.audio.readyTimeoutMs;
        while (token === this.generation && Date.now() < deadline) {
            let ready;
            try { ready = await this.probe(config.app.processBinary); }
            catch { break; }
            if (ready) {
                if (token === this.generation) this.state = "ready";
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (token === this.generation) this.state = "unavailable";
    }
}
