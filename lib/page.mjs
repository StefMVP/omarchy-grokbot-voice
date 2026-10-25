export function installPage() {
    let generation = 0;
    const cancellations = new Set();
    const byLabel = (re) => [...document.querySelectorAll("[aria-label]")].find((el) => re.test(el.getAttribute("aria-label")));
    const panel = () => document.querySelector("[data-voice-call-popover]");
    const phase = () => panel() ? panel().getAttribute("data-voice-call-phase") || "unknown" : "idle";
    const active = () => !["idle", "ended"].includes(phase());
    const muted = () => !!byLabel(/^unmute$/i);
    const mark = () => {
        const href = panel()?.querySelector("use")?.getAttribute("href") || "";
        const prefix = "#sand-agent-mark-source-";
        return href.startsWith(prefix) ? href.slice(prefix.length) : "";
    };
    const state = () => ({ ok: true, phase: phase(), muted: muted(), panel: !!panel() });
    const advance = (next) => {
        if (next > generation) {
            generation = next;
            for (const cancel of [...cancellations]) cancel();
        }
    };
    const until = (test, timeout, token) => new Promise((resolve) => {
        let observer;
        let timer;
        const finish = (value) => { observer?.disconnect(); clearTimeout(timer); cancellations.delete(cancel); resolve(value); };
        const cancel = () => finish(false);
        const check = () => {
            if (token !== generation) { finish(false); return; }
            if (test()) finish(true);
        };
        if (token !== generation || test()) { resolve(token === generation); return; }
        cancellations.add(cancel);
        observer = new MutationObserver(check);
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        timer = setTimeout(() => finish(false), timeout);
    });
    const cancelled = () => ({ ok: false, error: "Call operation cancelled" });
    let dialing = false;
    const endCall = async (token) => {
        if (token !== generation) return cancelled();
        if (dialing && !active()) {
            const appeared = await until(active, 4000, token);
            if (token !== generation) return cancelled();
            if (!appeared) return { ok: false, error: "Call start is still unconfirmed; retry hang-up" };
        }
        if (!active()) return { ...state(), already: true };
        const button = byLabel(/^hang up$/i);
        if (!button) return { ok: false, error: "Call may still be live: no hang-up control" };
        button.click();
        const stopped = await until(() => !active(), 4000, token);
        if (token !== generation) return cancelled();
        if (stopped) dialing = false;
        return stopped ? state() : { ok: false, error: "Hang-up was not confirmed; call may still be live" };
    };
    const closingAttribute = "data-grokbot-voice-closing";
    if (!document.getElementById("grokbot-voice-close-style")) {
        const style = document.createElement("style");
        style.id = "grokbot-voice-close-style";
        style.textContent = `[${closingAttribute}] [data-voice-call-popover], [${closingAttribute}] [data-voice-call-active] { visibility: hidden !important; }`;
        document.head.append(style);
    }
    const stop = async (token) => {
        if (token !== generation) return cancelled();
        const owner = String(token);
        document.documentElement.setAttribute(closingAttribute, owner);
        try { return await endCall(token); }
        finally {
            if (document.documentElement.getAttribute(closingAttribute) === owner) document.documentElement.removeAttribute(closingAttribute);
        }
    };
    const verified = (id) => phase() === "live" && mark() === id;
    const checkIdentity = async (id, token) => {
        if (verified(id)) return state();
        const stopped = await stop(token);
        return { ok: false, error: stopped.ok ? "Call bot identity is missing or different; hang-up confirmed" : "Call bot identity is missing or different; hang-up NOT confirmed" };
    };
    const select = async (id, token) => {
        if (active()) return { ok: false, error: "End the current call before selecting a bot" };
        const row = [...document.querySelectorAll("button[data-agent-id]")].find((el) => el.getAttribute("data-agent-id") === id);
        if (!row) return { ok: false, error: "Configured bot is not in the bot list" };
        const wanted = (row.getAttribute("aria-label") || "").split(",")[0].trim();
        if (!wanted) return { ok: false, error: "Configured bot has no accessible name" };
        const header = () => document.querySelector('[aria-label="View conversation details"]')?.textContent.trim();
        const pane = () => document.querySelector('[aria-label="Conversation transcript"]')?.textContent.trim();
        if (selectedId === id && header() === wanted) return { ok: true };
        selectedId = "";
        row.click();
        const ready = await until(() => header() === wanted && pane()?.startsWith(wanted), 2500, token);
        if (token !== generation) return cancelled();
        if (!ready) return { ok: false, error: "Could not confirm the configured bot conversation" };
        await new Promise((resolve) => setTimeout(resolve, 40));
        if (token !== generation) return cancelled();
        selectedId = id;
        return { ok: true };
    };
    let selectedId = "";
    globalThis.__grokbotVoice = {
        async call(command, id, token) {
            if (["start", "select", "stop"].includes(command)) advance(token);
            if (command === "status") return state();
            if (command === "doctor") return { ...state(), ok: !!byLabel(/^start voice chat$/i) || active(), error: byLabel(/^start voice chat$/i) || active() ? "" : "No voice call control in Grok Bot", control: !!byLabel(/^start voice chat$/i), version: (navigator.userAgent.match(/GrokBot\/[\d.]+/) || [""])[0] };
            if (token !== generation) return cancelled();
            if (command === "stop") return stop(token);
            if (command === "select") return select(id, token);
            if (command === "mute") {
                const button = byLabel(/^(un)?mute$/i);
                if (!button || phase() !== "live") return { ok: false, error: "No live call mute control" };
                const before = muted();
                button.click();
                const changed = await until(() => muted() !== before, 1000, token);
                return changed ? state() : { ok: false, error: "Mute change was not confirmed" };
            }
            if (command !== "start") return { ok: false, error: "Unknown page command" };
            if (active()) return checkIdentity(id, token);
            const selected = await select(id, token);
            if (!selected.ok) return selected;
            if (token !== generation) return cancelled();
            const button = byLabel(/^start voice chat$/i);
            if (!button) return { ok: false, error: "No call control in Grok Bot" };
            dialing = true;
            button.click();
            const live = await until(() => phase() === "live", 4000, token);
            if (token !== generation) return cancelled();
            if (!live) {
                const stopped = await stop(token);
                return { ok: false, error: stopped.ok ? "Call did not go live; hang-up confirmed" : "Call did not go live; hang-up NOT confirmed" };
            }
            return checkIdentity(id, token);
        },
    };
    return true;
}

export const installExpression = `(${installPage.toString()})()`;
export function callExpression(command, id, generation) {
    return `globalThis.__grokbotVoice ? globalThis.__grokbotVoice.call(${JSON.stringify(command)},${JSON.stringify(id)},${generation}) : ({ok:false, adapterMissing:true})`;
}
