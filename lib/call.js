function parseResult(text) {
    try {
        var value = JSON.parse(String(text || ""));
        if (!value || Array.isArray(value) || typeof value !== "object" || value.ok !== true)
            return { ok: false, error: String(value && value.error || "Call driver failed") };
        return value;
    } catch (error) {
        return { ok: false, error: "No valid answer from the call driver" };
    }
}

function initial() {
    return { generation: 0, status: "idle", opened: false, mayBeLive: false,
        muted: false, audio: "disabled", startedAt: 0, error: "" };
}
function begin(state, command) {
    var next = Object.assign({}, state, { generation: state.generation + 1, opened: true, error: "" });
    if (command === "start") {
        next.status = "calling";
        next.mayBeLive = true;
        next.audio = "pending";
        next.startedAt = 0;
    } else {
        next.status = "stopping";
        next.mayBeLive = true;
    }
    return next;
}
function complete(state, command, token, result, now) {
    if (token !== state.generation) return state;
    var next = Object.assign({}, state);
    if (!result.ok) {
        next.status = "error";
        next.opened = true;
        next.error = result.error || "Call may still be live";
        return next;
    }
    if (command === "stop" || (command === "status" && ["idle", "ended"].indexOf(result.phase) >= 0)) {
        next.status = "ended";
        next.mayBeLive = false;
        next.startedAt = 0;
        next.error = "";
    } else if (result.phase === "live") {
        if (!next.startedAt) next.startedAt = now;
        next.status = "live";
        next.mayBeLive = true;
        next.audio = result.audio || next.audio;
        next.muted = result.muted === true;
        next.error = "";
    }
    return next;
}
function close(state, token) {
    if (token !== state.generation || state.mayBeLive) return state;
    return Object.assign({}, initial(), { generation: state.generation + 1 });
}
function duration(ms) {
    var seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    return Math.floor(seconds / 60) + ":" + (seconds % 60 < 10 ? "0" : "") + seconds % 60;
}
function waveHeight(index, tick) {
    var phase = (Number(tick || 0) % 1000) / 1000 * Math.PI * 2;
    var base = [0.35, 0.62, 0.9, 0.7, 0.45, 0.78, 0.55, 0.85, 0.5][index % 9];
    return Math.max(0.12, base * (0.72 + 0.28 * Math.sin(phase + index * 0.7)));
}
