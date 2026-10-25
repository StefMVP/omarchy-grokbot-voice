import QtQuick
import Quickshell.Services.Pipewire

Item {
    id: root
    property bool enabled: false
    property bool muted: false
    property string processBinary: ""
    readonly property var streams: enabled ? Pipewire.nodes.values.filter(node => node.isStream && !!node.audio) : []
    readonly property var inputStream: stream("Stream/Input/Audio")
    readonly property var outputStream: stream("Stream/Output/Audio")
    readonly property var inputSource: {
        for (var link of Pipewire.linkGroups.values) {
            if (link.target === inputStream) return link.source
        }
        return null
    }
    readonly property real peak: enabled ? Math.max(muted ? 0 : input.peak, output.peak) : 0

    function stream(mediaClass) {
        for (var node of streams) {
            if (!node.ready) continue
            var props = node.properties
            if (props["application.process.binary"] === processBinary && props["media.class"] === mediaClass) return node
        }
        return null
    }

    PwObjectTracker { objects: root.streams }
    PwNodePeakMonitor { id: input; node: root.inputSource; enabled: root.enabled && !root.muted && !!node }
    PwNodePeakMonitor { id: output; node: root.outputStream; enabled: root.enabled && !!node }
}
