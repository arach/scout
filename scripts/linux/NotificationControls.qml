pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons

Column {
    id: root
    spacing: Style.space(8)
    property string executable: Quickshell.env("HOME") + "/.local/bin/scout-notifications"
    property var preferences: ({})
    property var runtime: null
    property string error: ""
    readonly property bool ready: preferences.enabled !== undefined

    function read() {
        if (reader.running || writer.running)
            return;
        reader.command = [executable, "status"];
        reader.running = true;
    }
    function setPreference(key, value) {
        if (writer.running)
            return;
        writer.command = [executable, "set", key, String(value)];
        writer.running = true;
    }
    function accept(text) {
        try {
            var result = JSON.parse(text);
            if (!result.ok)
                throw new Error("Settings unavailable");
            preferences = result.settings;
            runtime = result.runtime;
            error = "";
        } catch (e) {
            error = "Could not read notification settings.";
        }
    }

    Component.onCompleted: read()
    onVisibleChanged: if (visible)
        read()
    Timer {
        interval: 15000
        repeat: true
        running: root.visible
        onTriggered: root.read()
    }
    Process {
        id: reader
        stdout: StdioCollector {
            onStreamFinished: root.accept(text)
        }
        onExited: function (code) {
            if (code !== 0)
                root.error = "Notification service unavailable.";
        }
    }
    Process {
        id: writer
        stdout: StdioCollector {
            onStreamFinished: root.accept(text)
        }
        onExited: function (code) {
            if (code !== 0)
                root.error = "Could not save notification settings.";
        }
    }

    Text {
        width: parent.width
        text: "Notifications"
        font.family: Style.font.family
        font.pixelSize: Math.max(12, Style.font.body)
        font.weight: Font.DemiBold
        color: Color.popups.text
    }
    Repeater {
        model: [
            {
                key: "enabled",
                label: "Desktop notifications"
            },
            {
                key: "inbound",
                label: "Inbound communication"
            },
            {
                key: "outbound",
                label: "Outbound communication"
            },
            {
                key: "attention",
                label: "Questions, failures and requested results"
            },
            {
                key: "previews",
                label: "Message previews"
            }
        ]
        delegate: Switch {
            id: settingSwitch
            required property var modelData
            width: root.width
            text: modelData.label
            checked: root.preferences[modelData.key] === true
            enabled: root.ready && !writer.running && (modelData.key === "enabled" || root.preferences.enabled)
            font.family: Style.font.family
            font.pixelSize: Math.max(12, Style.font.body)
            onClicked: root.setPreference(modelData.key, checked)
            contentItem: Text {
                text: settingSwitch.text
                color: Color.popups.text
                opacity: settingSwitch.enabled ? 1 : 0.45
                font: settingSwitch.font
                verticalAlignment: Text.AlignVCenter
                leftPadding: settingSwitch.indicator.width + settingSwitch.spacing
                wrapMode: Text.WordWrap
            }
        }
    }
    Switch {
        id: scopeSwitch
        width: root.width
        text: "Include agent-to-agent communication"
        checked: root.preferences.scope === "all"
        enabled: root.ready && root.preferences.enabled && !writer.running
        font.family: Style.font.family
        font.pixelSize: Math.max(12, Style.font.body)
        onClicked: root.setPreference("scope", checked ? "all" : "operator")
        contentItem: Text {
            text: scopeSwitch.text
            color: Color.popups.text
            opacity: scopeSwitch.enabled ? 1 : 0.45
            font: scopeSwitch.font
            verticalAlignment: Text.AlignVCenter
            leftPadding: scopeSwitch.indicator.width + scopeSwitch.spacing
            wrapMode: Text.WordWrap
        }
    }
    Text {
        width: parent.width
        text: root.error || (!root.runtime || Date.now() - root.runtime.updatedAt > 45000 ? "Notification service is not running." : root.runtime.connected ? "Connected · Changes apply immediately · Respects Do Not Disturb" : "Waiting for Scout’s broker…")
        color: root.error ? Color.urgent : Util.alpha(Color.popups.text, 0.65)
        font.family: Style.font.family
        font.pixelSize: Math.max(10, Style.font.caption)
        wrapMode: Text.WordWrap
    }
}
