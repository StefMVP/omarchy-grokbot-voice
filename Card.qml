import QtQuick
import QtQuick.Layouts
import QtQuick.Shapes
import "lib/call.js" as Call

Rectangle {
    id: card

    property string status: "idle"
    property bool muted: false
    property bool connecting: false
    property bool audioUnavailable: false
    property int dots: 0
    property real peak: 0
    property real noiseFloorDb: -48
    property real peakDb: -24
    property int silentFrames: 0
    property var levels: Array(31).fill(0)
    property real seconds: 0
    property string errorText: ""

    property color ink: "#f69412"
    property color surface: "#1f1f1f"
    property color text: "#f5f5f5"
    property color textSecondary: "#8af5f5f5"
    property color buttonFill: "#0af5f5f5"
    property color buttonIcon: "#a3f5f5f5"
    property color danger: "#cf2b35"
    property string fontFamily: "sans-serif"

    signal hangUp()
    signal toggleMute()

    readonly property int gap: 10
    readonly property bool waveVisible: status === "live" && !connecting && !audioUnavailable

    implicitWidth: 400
    implicitHeight: 84
    radius: 42
    color: surface
    border.width: 1
    border.color: "#10f5f5f5"

    onWaveVisibleChanged: levels = Array(31).fill(0)
    Timer {
        interval: 20
        repeat: true
        running: card.visible && card.waveVisible
        onTriggered: {
            var level = Call.voiceLevel(card.peak, card.noiseFloorDb, card.peakDb)
            if (level === 0 && card.silentFrames >= 4) return
            card.silentFrames = level === 0 ? card.silentFrames + 1 : 0
            card.levels = card.silentFrames >= 4 ? Array(31).fill(0) : card.levels.slice(1).concat([level])
        }
    }

    Timer {
        interval: 380
        repeat: true
        running: card.connecting
        onTriggered: card.dots = (card.dots + 1) % 4
    }

    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: 12
        anchors.rightMargin: 12
        spacing: card.gap

        Item {
            implicitWidth: 196
            implicitHeight: 56
            visible: card.waveVisible

            Rectangle {
                anchors.centerIn: parent
                width: parent.width
                height: 2
                radius: 1
                color: card.ink
            }
            Row {
                anchors.centerIn: parent
                spacing: 3
                Repeater {
                    model: 31
                    Rectangle {
                        width: 3
                        radius: 1.5
                        color: card.ink
                        implicitHeight: 2 + 54 * (card.levels[index] || 0)
                        anchors.verticalCenter: parent.verticalCenter
                        Behavior on implicitHeight {
                            NumberAnimation { duration: 32; easing.type: Easing.OutQuad }
                        }
                    }
                }
            }
        }

        Row {
            spacing: 6
            visible: card.connecting
            Layout.alignment: Qt.AlignVCenter

            Repeater {
                model: 3

                Rectangle {
                    width: 7
                    height: 7
                    radius: 3.5
                    color: card.ink
                    opacity: card.dots > index ? 1 : 0.25

                    Behavior on opacity {
                        NumberAnimation { duration: 140 }
                    }
                }
            }
        }

        Item {
            Layout.fillWidth: true
            implicitHeight: 44

            Text {
                anchors.verticalCenter: parent.verticalCenter
                anchors.left: parent.left
                text: {
                    if (card.status === "error")
                        return card.errorText.length > 0 ? card.errorText : "No call";
                    if (card.connecting)
                        return (card.status === "calling" ? "Connecting" : "Joining") + "\u2026".repeat(card.dots);
                    if (card.audioUnavailable)
                        return "Check app audio";
                    return Call.duration(card.seconds * 1000);
                }
                color: card.status === "error" ? card.danger : (card.connecting ? card.ink : card.textSecondary)
                font.family: card.fontFamily
                font.pixelSize: card.connecting ? 13 : 12
                font.weight: card.connecting ? Font.Medium : Font.Normal
                elide: Text.ElideRight
                width: parent.width
            }
        }

        Rectangle {
            implicitWidth: 44
            implicitHeight: 44
            radius: 22
            color: card.muted ? "#1ff5f5f5" : card.buttonFill

            Shape {
                anchors.centerIn: parent
                width: 18
                height: 22

                ShapePath {
                    strokeWidth: 1.8
                    strokeColor: card.muted ? card.danger : card.buttonIcon
                    fillColor: "transparent"
                    capStyle: ShapePath.RoundCap
                    PathSvg { path: "M9 2.2a3.1 3.1 0 0 1 3.1 3.1v5.2a3.1 3.1 0 0 1-6.2 0V5.3A3.1 3.1 0 0 1 9 2.2Z" }
                }
                ShapePath {
                    strokeWidth: 1.8
                    strokeColor: card.muted ? card.danger : card.buttonIcon
                    fillColor: "transparent"
                    capStyle: ShapePath.RoundCap
                    PathSvg { path: "M2.6 9.6a6.4 6.4 0 0 0 12.8 0M9 16v3.4M5.8 19.4h6.4" }
                }
                ShapePath {
                    strokeWidth: card.muted ? 1.8 : 0
                    strokeColor: card.muted ? card.danger : "transparent"
                    fillColor: "transparent"
                    capStyle: ShapePath.RoundCap
                    PathSvg { path: "M3 2.6 15 18.4" }
                }
            }

            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: card.toggleMute()
            }
        }

        Rectangle {
            implicitWidth: 44
            implicitHeight: 44
            radius: 22
            color: card.danger

            Shape {
                anchors.centerIn: parent
                width: 16
                height: 16

                ShapePath {
                    strokeWidth: 2
                    strokeColor: "#f5f5f5"
                    fillColor: "transparent"
                    capStyle: ShapePath.RoundCap
                    PathSvg { path: "M2.5 2.5 13.5 13.5M13.5 2.5 2.5 13.5" }
                }
            }

            MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onPressed: card.hangUp()
            }
        }
    }
}
