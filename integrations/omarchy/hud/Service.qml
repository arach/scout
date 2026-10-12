import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import "HudModel.js" as Model

Item {
    id: root
    property bool enabled: true
    property bool opened: false
    property bool pinned: false
    property bool motion: true
    property bool preferencesLoaded: false
    property string screenName: ""
    property var snapshot: ({errors: {}})
    property string loadError: ""
    property double fullAt: 0
    property double now: Date.now()
    property bool refreshQueued: false
    readonly property bool shown: enabled && (opened || pinned)
    readonly property string bin: (Quickshell.env("SCOUT_DESKTOP_BIN_DIR") || Quickshell.env("HOME") + "/.local/bin").replace(/\/$/, "") + "/"
    readonly property string configHome: Quickshell.env("XDG_CONFIG_HOME") || Quickshell.env("HOME") + "/.config"
    readonly property bool fresh: !loadError && Model.fresh(snapshot, now)
    readonly property var capacities: fresh ? Model.capacities(snapshot, fullAt, now) : []
    readonly property var work: fresh ? Model.work(snapshot, fullAt, now) : []
    readonly property color accent: "#8fe0da"
    readonly property color ink: "#e8e4df"
    readonly property color muted: "#9ba9a8"

    function savePreferences() {
        if (preferencesLoaded) preferences.setText(JSON.stringify({enabled: enabled, pinned: pinned, motion: motion, screen: screenName}, null, 2) + "\n");
    }
    function refresh() {
        if (reader.running) { refreshQueued = true; return; }
        reader.command = [bin + "scout-menu-status"].concat(shown ? ["--full"] : []);
        reader.running = true;
    }
    function count(key, errorKey) {
        if (errorKey === "work" && (!fullAt || now - fullAt >= 90000)) return "—";
        return fresh ? Model.validCount(snapshot, key, errorKey, now) : "—";
    }
    function open() { enabled = true; opened = true; }
    function close() { pinned = false; opened = false; savePreferences(); }
    onShownChanged: if (shown) refresh()

    FileView {
        id: preferences
        path: root.configHome + "/openscout/linux-hud.json"
        atomicWrites: true
        printErrors: false
        onLoaded: {
            try {
                var value = JSON.parse(text());
                root.enabled = value.enabled !== false;
                root.pinned = value.pinned === true;
                root.motion = value.motion !== false;
                root.screenName = typeof value.screen === "string" ? value.screen : "";
            } catch (e) { console.warn("Scout HUD preferences unavailable:", e); }
            root.preferencesLoaded = true;
        }
        onLoadFailed: root.preferencesLoaded = true
    }
    Process {
        id: reader
        stdout: StdioCollector {
            waitForEnd: true
            onStreamFinished: {
                try {
                    var incoming = JSON.parse(text);
                    if (!incoming.updatedAt) throw new Error("Missing snapshot time");
                    if (incoming.full) root.fullAt = incoming.updatedAt;
                    var errors = Object.assign({}, root.snapshot.errors, incoming.errors);
                    if (!incoming.errors.service) delete errors.service;
                    if (!incoming.errors.blocked) delete errors.blocked;
                    if (incoming.full) errors = incoming.errors;
                    root.snapshot = Object.assign({}, root.snapshot, incoming, {errors: errors});
                    root.now = Date.now(); root.loadError = "";
                } catch (e) { root.loadError = "Scout status unavailable"; }
            }
        }
        onExited: function(code) {
            if (code !== 0) root.loadError = "Scout status unavailable";
            if (root.refreshQueued) { root.refreshQueued = false; retry.start(); }
        }
    }
    Timer { id: retry; interval: 50; onTriggered: root.refresh() }
    Timer { interval: root.shown ? 30000 : 60000; running: root.enabled; repeat: true; onTriggered: root.refresh() }
    Timer { interval: 1000; running: root.shown; repeat: true; onTriggered: root.now = Date.now() }
    Timer { id: reveal; interval: 180; onTriggered: if (hover.hovered) root.open() }
    Timer { id: collapse; interval: 550; onTriggered: if (!hover.hovered && !root.pinned) root.opened = false }
    Component.onCompleted: refresh()

    IpcHandler {
        target: "scout.hud"
        function open(): void { root.open(); }
        function close(): void { root.close(); }
        function toggle(): void { root.shown ? root.close() : root.open(); }
        function hide(): void { root.close(); root.enabled = false; root.savePreferences(); }
        function show(): void { root.enabled = true; root.savePreferences(); }
        function setMotion(value: bool): void { root.motion = value; root.savePreferences(); }
        function state(): string { return JSON.stringify({enabled: root.enabled, open: root.shown, pinned: root.pinned, motion: root.motion, fresh: root.fresh, screen: panel.screen ? panel.screen.name : ""}); }
    }

    PanelWindow {
        id: panel
        visible: root.enabled
        screen: Quickshell.screens.find(function(s) { return s.name === root.screenName; }) || Quickshell.screens[0]
        anchors.left: true
        implicitWidth: root.shown ? 372 : 28
        implicitHeight: Math.min(700, Math.max(120, (screen ? screen.height : 800) - 100))
        color: "transparent"
        exclusionMode: ExclusionMode.Ignore
        WlrLayershell.namespace: "scout-hud"
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
        Behavior on implicitWidth { enabled: root.motion; NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

        Item {
            anchors.fill: parent
            clip: true
            HoverHandler {
                id: hover
                onHoveredChanged: {
                    if (hovered) { collapse.stop(); if (!root.shown) reveal.restart(); }
                    else { reveal.stop(); collapse.restart(); }
                }
            }
            Rectangle {
                id: handle
                x: parent.width - width
                anchors.verticalCenter: parent.verticalCenter
                width: 28; height: 132; radius: 8
                color: "#141d20"
                border.color: "#436463"
                Text { anchors.centerIn: parent; text: "S C O U T"; rotation: -90; color: root.accent; font.family: "monospace"; font.pixelSize: 10 }
                Rectangle { x: 1; y: 18; width: 2; height: 96; color: root.accent; opacity: 0.6 }
                MouseArea { anchors.fill: parent; cursorShape: Qt.PointingHandCursor; onClicked: root.shown ? root.close() : root.open() }
            }
            Rectangle {
                id: card
                width: 340; height: parent.height
                x: parent.width - width - 28
                visible: panel.width > 28
                color: "#101719"; radius: 12
                border.width: 1; border.color: "#3d5555"
                clip: true
                // Decorative light only. It stops completely when folded or motion is off.
                Rectangle {
                    id: light
                    width: 130; height: card.height
                    rotation: 16; opacity: 0.08
                    gradient: Gradient {
                        orientation: Gradient.Horizontal
                        GradientStop { position: 0; color: "transparent" }
                        GradientStop { position: 0.5; color: root.accent }
                        GradientStop { position: 1; color: "transparent" }
                    }
                    SequentialAnimation on x {
                        running: root.shown && root.motion
                        loops: Animation.Infinite
                        NumberAnimation { from: -180; to: 460; duration: 16000 }
                        PauseAnimation { duration: 4000 }
                    }
                }
                Flickable {
                    anchors.fill: parent; anchors.margins: 20
                    contentHeight: content.implicitHeight
                    clip: true; boundsBehavior: Flickable.StopAtBounds
                    ColumnLayout {
                        id: content
                        width: parent.width
                        spacing: 16
                        RowLayout {
                            Layout.fillWidth: true
                            Text { text: "SCOUT / HUD"; color: root.accent; font.family: "monospace"; font.pixelSize: 12; font.letterSpacing: 2; Layout.fillWidth: true }
                            HudButton { text: root.pinned ? "Unpin" : "Pin"; checked: root.pinned; onClicked: { root.pinned = !root.pinned; root.savePreferences(); } }
                            HudButton { text: "×"; onClicked: root.close(); Accessible.name: "Close Scout HUD" }
                        }
                        Text { text: root.snapshot.host || "This machine"; color: root.ink; font.pixelSize: 22; elide: Text.ElideRight; Layout.fillWidth: true }
                        RowLayout {
                            Rectangle { width: 6; height: 6; radius: 3; color: !root.fresh || root.snapshot.errors.service ? "#9ba9a8" : root.snapshot.brokerUp ? root.accent : "#e2564d" }
                            Text { text: !root.fresh || root.snapshot.errors.service ? "Status unavailable · refresh to retry" : root.snapshot.brokerUp ? "Broker running" : "Broker stopped"; color: root.muted; font.pixelSize: 11 }
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: "#2d3e3f" }
                        RowLayout {
                            spacing: 24
                            Repeater {
                                model: [{key: "needsYouCount", error: "blocked", label: "NEEDS YOU"}, {key: "activeCount", error: "work", label: "TRACKED WORK"}]
                                ColumnLayout {
                                    required property var modelData
                                    Text { text: root.count(modelData.key, modelData.error); color: root.ink; font.pixelSize: 30; font.family: "monospace" }
                                    Text { text: modelData.label; color: root.muted; font.pixelSize: 9; font.letterSpacing: 1 }
                                }
                            }
                        }
                        Text { text: "CAPACITY REMAINING"; color: root.muted; font.pixelSize: 10; font.letterSpacing: 1 }
                        Repeater {
                            model: root.capacities
                            ColumnLayout {
                                required property var modelData
                                Layout.fillWidth: true
                                spacing: 6
                                RowLayout {
                                    Text { text: modelData.provider; color: root.ink; font.pixelSize: 12; Layout.fillWidth: true }
                                    Text { text: modelData.remaining === null ? "Unavailable" : Math.round(modelData.remaining) + "%"; color: root.accent; font.family: "monospace"; font.pixelSize: 12 }
                                }
                                Rectangle {
                                    Layout.fillWidth: true; height: 3; color: "#273638"
                                    Rectangle { height: 3; width: parent.width * (modelData.remaining === null ? 0 : modelData.remaining / 100); color: root.accent }
                                }
                            }
                        }
                        Text { visible: root.capacities.length === 0; text: reader.running ? "Reading provider limits…" : "Capacity unavailable"; color: root.muted; font.pixelSize: 12 }
                        Repeater {
                            model: root.work
                            Text { required property var modelData; text: modelData.title || modelData.summary || "Tracked work"; wrapMode: Text.Wrap; maximumLineCount: 2; elide: Text.ElideRight; color: root.ink; font.pixelSize: 12; Layout.fillWidth: true }
                        }
                        Rectangle { Layout.fillWidth: true; height: 1; color: "#2d3e3f" }
                        RowLayout {
                            Layout.fillWidth: true
                            HudButton { text: "Open TUI ↗"; Layout.fillWidth: true; onClicked: Quickshell.execDetached([root.bin + "scout-hud-tui"]) }
                            HudButton { text: "Scout ↗"; onClicked: Quickshell.execDetached([root.bin + "scout-omarchy"]) }
                        }
                        RowLayout {
                            Layout.fillWidth: true
                            HudButton { text: "Refresh"; enabled: !reader.running; onClicked: root.refresh() }
                            HudButton { text: root.motion ? "Motion on" : "Motion off"; checked: root.motion; onClicked: { root.motion = !root.motion; root.savePreferences(); } }
                        }
                        Text { text: root.pinned ? "Pinned · close to tuck away" : "Approach to peek · leave to tuck away"; color: root.muted; font.pixelSize: 10 }
                    }
                }
            }
        }
    }
}
