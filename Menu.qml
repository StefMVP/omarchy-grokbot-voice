import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons as Commons
import "lib/call.js" as Call

Item {
    id: root
    property var shell: null
    property var manifest: null
    readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || Quickshell.env("HOME") + "/.config"
    readonly property string configPath: Quickshell.env("GROKBOT_VOICE_CONFIG") || configHome + "/grokbot-voice/config.json"
    readonly property string pluginDir: manifest && manifest.__sourceDir ? String(manifest.__sourceDir) : configHome + "/omarchy/plugins/grokbot.voice"
    readonly property string callBin: pluginDir + "/bin/grokbot-voice-call"
    property var config: ({ position: "bottom", margin: 28 })
    property var session: Call.initial()
    property real seconds: 0

    FileView {
        path: root.configPath
        watchChanges: true
        printErrors: false
        onFileChanged: { reload(); root.loadConfig() }
    }
    function loadConfig() {
        if (!settingsProc.running) settingsProc.running = true
    }
    Process {
        id: settingsProc
        command: [root.callBin, "settings"]
        stdout: StdioCollector { id: settingsOut; waitForEnd: true }
        onExited: {
            var result = Call.parseResult(settingsOut.text)
            if (result.ok && result.call) root.config = result.call
            else root.session = Call.complete(root.session, "settings", root.session.generation, result, Date.now())
        }
    }
    function finish(command, token, output) {
        var previous = root.session
        root.session = Call.complete(previous, command, token, Call.parseResult(output), Date.now())
        if (root.session !== previous && root.session.status === "ended") {
            closeSoon.token = root.session.generation
            closeSoon.restart()
        }
    }
    Process {
        id: startProc
        property int token: 0
        command: [root.callBin, "start"]
        stdout: StdioCollector { id: startOut; waitForEnd: true }
        onExited: root.finish("start", token, startOut.text)
    }
    Process {
        id: stopProc
        property int token: 0
        command: [root.callBin, "stop"]
        stdout: StdioCollector { id: stopOut; waitForEnd: true }
        onExited: root.finish("stop", token, stopOut.text)
    }
    Process {
        id: muteProc
        property int token: 0
        command: [root.callBin, "mute"]
        stdout: StdioCollector { id: muteOut; waitForEnd: true }
        onExited: root.finish("mute", token, muteOut.text)
    }
    Process {
        id: statusProc
        property int token: 0
        command: [root.callBin, "status"]
        stdout: StdioCollector { id: statusOut; waitForEnd: true }
        onExited: root.finish("status", token, statusOut.text)
    }
    Timer {
        interval: root.session.status === "live" && root.session.audio === "pending" ? 200 : 500
        repeat: true
        running: root.session.opened && root.session.status !== "ended"
        onTriggered: {
            if (startProc.running || stopProc.running || muteProc.running || statusProc.running) return
            statusProc.token = root.session.generation
            statusProc.running = true
        }
    }
    Timer {
        interval: 1000
        repeat: true
        running: root.session.status === "live"
        onTriggered: root.seconds = (Date.now() - root.session.startedAt) / 1000
    }
    Timer {
        id: closeSoon
        property int token: 0
        interval: 2200
        onTriggered: root.session = Call.close(root.session, token)
    }
    function start() {
        if (startProc.running || stopProc.running || root.session.mayBeLive) return
        closeSoon.stop()
        root.session = Call.begin(root.session, "start")
        root.seconds = 0
        startProc.token = root.session.generation
        startProc.running = true
    }
    function hangup() {
        if (stopProc.running) return
        closeSoon.stop()
        root.session = Call.begin(root.session, "stop")
        stopProc.token = root.session.generation
        stopProc.running = true
    }
    function toggleMute() {
        if (muteProc.running || stopProc.running || root.session.status !== "live") return
        muteProc.token = root.session.generation
        muteProc.running = true
    }
    function toggle() {
        if (root.session.mayBeLive) hangup()
        else start()
    }
    function show() {
        root.session = Object.assign({}, root.session, { opened: true })
        if (!statusProc.running) {
            statusProc.token = root.session.generation
            statusProc.running = true
        }
    }
    Process { id: warm; command: [root.callBin, "doctor"] }
    Component.onCompleted: { loadConfig(); warm.running = true }
    IpcHandler {
        target: "grokbot.voice"
        function ping(): string { return "ok" }
        function talk(): string { root.toggle(); return "ok" }
        function toggle(): string { root.toggle(); return "ok" }
        function call(): string { root.start(); return "ok" }
        function hangup(): string { root.hangup(); return "ok" }
        function mute(): string { root.toggleMute(); return "ok" }
        function show(): string { root.show(); return "ok" }
        function state(): string { return JSON.stringify(root.session) }
    }
    PanelWindow {
        id: win
        visible: root.session.opened
        anchors.top: root.config.position === "top"
        anchors.bottom: root.config.position !== "top"
        anchors.left: true
        margins.left: Math.round(((win.screen ? win.screen.width : 1920) - card.width) / 2)
        margins.top: root.config.position === "top" ? root.config.margin : 0
        margins.bottom: root.config.position === "top" ? 0 : root.config.margin
        implicitWidth: card.width
        implicitHeight: card.height
        color: "transparent"
        exclusionMode: ExclusionMode.Ignore
        WlrLayershell.namespace: "grokbot-voice"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
        Card {
            id: card
            status: root.session.status
            connecting: root.session.status === "calling" || root.session.status === "stopping" || (root.session.status === "live" && root.session.audio === "pending")
            audioUnavailable: root.session.audio === "unavailable"
            muted: root.session.muted
            seconds: root.seconds
            errorText: root.session.error
            surface: Commons.Color.background
            text: Commons.Color.foreground
            textSecondary: Qt.rgba(Commons.Color.foreground.r, Commons.Color.foreground.g, Commons.Color.foreground.b, 0.54)
            buttonFill: Qt.rgba(Commons.Color.foreground.r, Commons.Color.foreground.g, Commons.Color.foreground.b, 0.04)
            buttonIcon: Qt.rgba(Commons.Color.foreground.r, Commons.Color.foreground.g, Commons.Color.foreground.b, 0.64)
            onHangUp: root.hangup()
            onToggleMute: root.toggleMute()
        }
    }
}
