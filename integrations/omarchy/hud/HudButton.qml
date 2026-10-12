import QtQuick
import QtQuick.Controls

Button {
    id: control
    implicitHeight: 32
    hoverEnabled: true
    focusPolicy: Qt.NoFocus
    palette.buttonText: "#e8e4df"
    font.family: "monospace"
    font.pixelSize: 11
    contentItem: Text {
        text: control.text
        color: control.checked ? "#8fe0da" : "#d2c9bf"
        font: control.font
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
    }
    background: Rectangle {
        color: control.hovered ? "#263334" : "#171c1d"
        radius: 5
        border.width: 1
        border.color: control.checked ? "#447c79" : "#303a3a"
    }
}
