// Scout presentation for a user-owned clone of omarchy.notifications.
// The native service still owns delivery, history, DND, actions and lifetime.
import QtQuick
import QtQuick.Layouts
import Quickshell
import qs.Commons
import "../NotificationLogic.js" as NotificationLogic

Item {
    id: root

    property string app: ""
    property string appIcon: ""
    property string summary: ""
    property string body: ""
    property string image: ""
    property string glyph: ""
    property int urgency: 1
    property double timestamp: 0
    property int cornerRadius: 0
    property string fontFamily: ""

    signal closeRequested()
    signal cardClicked()

    readonly property bool isScout: app === "Scout"
    readonly property bool demo: /^Scout · Demo · /.test(summary)
    readonly property bool outgoing: /^Scout · (Demo · )?(Outgoing · |OUT → IN)/.test(summary)
    readonly property bool incoming: /^Scout · (Demo · )?(Incoming · |IN → OUT)/.test(summary)
    readonly property string heading: summary.replace(/^Scout · (Demo · )?(Incoming · |Outgoing · )?/, "")
    readonly property string route: heading === "OUT → IN" ? "You → Peer" : heading === "IN → OUT" ? "Peer → You" : heading
    readonly property color tone: urgency === 2 ? Color.urgent : incoming ? "#adbfaa" : outgoing ? "#d6b987" : Color.notifications.countdown
    readonly property color textColor: Color.notifications.text
    readonly property string styledBody: NotificationLogic.styledBody(body, app, appIcon)
    readonly property bool hovered: isScout ? hoverTracker.hovered : nativeCard.hovered
    // The stock popup slot pauses its timer when hovered. Share that clock
    // rather than adding a second lifetime timer to the presentation.
    readonly property real remaining: parent && parent.remainingLifetime !== undefined ? parent.remainingLifetime : 1
    readonly property bool timed: parent && parent.lifetime !== undefined && parent.lifetime > 0

    implicitWidth: isScout ? Style.space(380) : nativeCard.implicitWidth
    implicitHeight: isScout ? scoutCard.implicitHeight : nativeCard.implicitHeight
    width: implicitWidth
    height: implicitHeight

    NativeNotificationCard {
        id: nativeCard
        visible: !root.isScout
        width: root.width
        app: root.app
        appIcon: root.appIcon
        summary: root.summary
        body: root.body
        image: root.image
        glyph: root.glyph
        urgency: root.urgency
        timestamp: root.timestamp
        cornerRadius: root.cornerRadius
        fontFamily: root.fontFamily
        onCloseRequested: root.closeRequested()
        onCardClicked: root.cardClicked()
    }

    Rectangle {
        id: scoutCard
        visible: root.isScout
        width: root.width
        height: implicitHeight
        implicitHeight: content.implicitHeight + Style.space(28)
        radius: Style.space(8)
        color: Qt.lighter(Color.notifications.background, 1.18)
        border.width: 1
        border.color: Util.alpha(root.hovered ? root.tone : root.textColor, root.hovered ? 0.5 : 0.22)
        Behavior on border.color { ColorAnimation { duration: 140 } }

        HoverHandler { id: hoverTracker }

        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            acceptedButtons: Qt.LeftButton | Qt.RightButton
            onClicked: function(mouse) {
                if (mouse.button === Qt.RightButton) root.closeRequested()
                else root.cardClicked()
            }
        }

        ColumnLayout {
            id: content
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.margins: Style.space(14)
            spacing: Style.space(7)

            RowLayout {
                Layout.fillWidth: true
                spacing: Style.space(7)

                Image {
                    Layout.preferredWidth: Style.space(16)
                    Layout.preferredHeight: Style.space(16)
                    source: Quickshell.iconPath("scout", true)
                    sourceSize.width: width * Screen.devicePixelRatio
                    sourceSize.height: height * Screen.devicePixelRatio
                    smooth: true
                    opacity: 0.8
                }

                Text {
                    text: "SCOUT"
                    textFormat: Text.PlainText
                    font.family: "Liberation Sans"
                    font.pixelSize: Math.round(10 * Style.fontScale)
                    font.weight: Font.DemiBold
                    font.letterSpacing: 1.2 * Style.fontScale
                    color: Util.alpha(root.textColor, 0.78)
                }

                Text {
                    visible: root.demo
                    text: "PREVIEW"
                    textFormat: Text.PlainText
                    font.family: "Liberation Sans"
                    font.pixelSize: Math.round(9 * Style.fontScale)
                    font.letterSpacing: 0.6 * Style.fontScale
                    color: Util.alpha(root.textColor, 0.6)
                }

                Item { Layout.fillWidth: true }

                Rectangle {
                    implicitWidth: directionLabel.implicitWidth + Style.space(14)
                    implicitHeight: Style.space(22)
                    radius: Style.space(4)
                    color: Util.alpha(root.tone, 0.1)
                    border.color: Util.alpha(root.tone, 0.22)
                    border.width: 1

                    Text {
                        id: directionLabel
                        anchors.centerIn: parent
                        text: root.outgoing ? "OUT → IN" : root.incoming ? "IN → OUT" : "UPDATE"
                        textFormat: Text.PlainText
                        font.family: "Liberation Sans"
                        font.pixelSize: Math.round(10 * Style.fontScale)
                        font.weight: Font.DemiBold
                        font.letterSpacing: 0.6 * Style.fontScale
                        color: root.tone
                    }
                }

                Item {
                    Layout.preferredWidth: Style.space(22)
                    Layout.preferredHeight: Style.space(22)

                    Text {
                        anchors.centerIn: parent
                        text: "×"
                        textFormat: Text.PlainText
                        font.family: "Liberation Sans"
                        font.pixelSize: Math.round(17 * Style.fontScale)
                        color: Util.alpha(root.textColor, closeHover.hovered ? 1 : root.hovered ? 0.8 : 0.4)
                    }
                    HoverHandler { id: closeHover }
                    MouseArea {
                        anchors.fill: parent
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.closeRequested()
                    }
                }
            }

            Text {
                Layout.fillWidth: true
                text: root.route
                textFormat: Text.PlainText
                font.family: "Liberation Sans"
                font.pixelSize: Math.round(15 * Style.fontScale)
                font.weight: Font.DemiBold
                color: root.textColor
                wrapMode: Text.WordWrap
                elide: Text.ElideRight
                maximumLineCount: 2
            }

            Text {
                Layout.fillWidth: true
                visible: root.styledBody.length > 0
                text: root.styledBody
                textFormat: Text.StyledText
                font.family: "Liberation Sans"
                font.pixelSize: Math.round(13 * Style.fontScale)
                color: Util.alpha(root.textColor, 0.8)
                wrapMode: Text.WordWrap
                elide: Text.ElideRight
                maximumLineCount: 3
                lineHeight: 1.12
            }
        }

        Rectangle {
            visible: root.timed
            anchors.bottom: parent.bottom
            anchors.left: parent.left
            anchors.bottomMargin: Style.space(5)
            anchors.leftMargin: Style.space(14)
            width: (parent.width - Style.space(28)) * Math.max(0, root.remaining)
            height: 1
            radius: 0.5
            color: Util.alpha(root.tone, root.hovered ? 0.65 : 0.4)
            Behavior on width { NumberAnimation { duration: 50 } }
        }

        opacity: 0
        transform: Translate { id: entrance; y: Style.space(5) }
        Component.onCompleted: appear.start()
        ParallelAnimation {
            id: appear
            NumberAnimation { target: scoutCard; property: "opacity"; to: 1; duration: 150 }
            NumberAnimation { target: entrance; property: "y"; to: 0; duration: 180; easing.type: Easing.OutCubic }
        }
    }
}
