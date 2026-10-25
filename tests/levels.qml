import QtQuick
import Quickshell
import Quickshell.Io

ShellRoot {
    VoiceLevels { id: voice; enabled: true; processBinary: "voice-level-test" }
    Card { id: card; status: "live"; peak: voice.peak }
    IpcHandler {
        target: "test"
        function state(): string {
            return JSON.stringify({ peak: voice.peak, levels: card.levels,
                input: !!voice.inputStream, output: !!voice.outputStream, source: !!voice.inputSource })
        }
        function mute(value: bool): void { voice.muted = value }
        function enable(value: bool): void { voice.enabled = value }
    }
}
