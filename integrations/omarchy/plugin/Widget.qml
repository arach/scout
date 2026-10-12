import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import qs.Ui
import qs.Commons

BarWidget {
    id: root

    readonly property color accent: Color.accent
    property bool actionFailed: false
    readonly property string barLogo: themedLogo(!unknown && (!snapshot.brokerUp || snapshot.blockedCount > 0) ? statusColor : (bar ? bar.foreground : Color.foreground))
    readonly property string bin: Quickshell.env("HOME") + "/.local/bin/"
    readonly property color card: Style.hoverFill
    readonly property color danger: Color.urgent
    readonly property color faint: Util.alpha(ink, 0.55)
    property string feedback: ""
    property string filter: ""
    readonly property var filteredActivity: (snapshot.activity || []).filter(function (a) {
        return (a.title + " " + a.actor).toLowerCase().indexOf(root.filter.toLowerCase()) !== -1;
    })
    readonly property color healthy: ink
    readonly property color ink: Color.popups.text
    readonly property color line: Util.alpha(ink, 0.16)
    property string loadError: ""
    readonly property string logo: themedLogo(bar ? bar.foreground : "#a7a7a7")
    property bool menuOpen: false
    readonly property string mono: Style.font.family
    readonly property color muted: Util.alpha(ink, 0.72)
    property double now: Date.now()
    readonly property bool opened: menuOpen
    readonly property color paper: Color.popups.background
    property string pendingStyle: ""
    property bool pinned: false
    property bool refreshQueued: false
    readonly property string sans: root.setting("proseFont", "Hanken Grotesk")
    readonly property int bodySize: Math.max(12, Style.font.body)
    readonly property int captionSize: Math.max(10, Style.font.caption)
    property var snapshot: ({
            errors: {},
            blocked: [],
            activity: [],
            budgets: [],
            peers: []
        })
    readonly property color statusColor: unknown ? faint : !snapshot.brokerUp ? danger : snapshot.blockedCount > 0 ? accent : healthy
    readonly property string statusLabel: unknown ? "Status unavailable" : snapshot.brokerUp ? "Broker running" : "Broker stopped"
    property string tab: "Now"
    property string workFilter: "All"
    property bool todayOnly: false
    readonly property bool unknown: !snapshot.updatedAt || !!loadError || !!snapshot.errors.service || !!snapshot.errors.blocked

    function actorLabel(value) {
        if (!value)
            return "Scout";
        if (value === "system")
            return "Scout system";
        if (value === "operator")
            return "You";
        return value;
    }
    function age(ts) {
        if (!ts)
            return "unknown";
        var seconds = Math.max(0, (now - ts) / 1000);
        if (seconds < 60)
            return "now";
        if (seconds < 3600)
            return Math.floor(seconds / 60) + "m ago";
        if (seconds < 86400)
            return Math.floor(seconds / 3600) + "h ago";
        return Math.floor(seconds / 86400) + "d ago";
    }
    function appearance(style) {
        if (styleProcess.running)
            return;
        pendingStyle = style;
        styleProcess.command = [bin + "scout-appearance", style];
        styleProcess.running = true;
    }
    function close() {
        menuOpen = false;
    }
    function focusedWidget() {
        var items = bar ? bar.moduleWidgets(moduleName) : [root];
        var focused = Hyprland.focusedMonitor;
        for (var i = 0; i < items.length; i++) {
            var win = items[i].QsWindow.window;
            if (win && win.screen && focused && win.screen.name === focused.name)
                return items[i];
        }
        return root;
    }
    function known(value) {
        return value !== undefined && value !== null;
    }
    function launch() {
        if (!pinned)
            menuOpen = false;
        Quickshell.execDetached([bin + "scout-omarchy"]);
    }
    function logs() {
        if (!pinned)
            menuOpen = false;
        Quickshell.execDetached(["omarchy", "launch", "tui", "journalctl", "--user", "-u", "scout.service", "-n", "100"]);
    }
    function open() {
        menuOpen = true;
        refresh();
    }
    function refresh() {
        if (reader.running) {
            refreshQueued = true;
            return;
        }
        reader.command = [bin + "scout-menu-status"].concat(menuOpen ? ["--full"] : []);
        reader.running = true;
    }
    function runAction(args) {
        if (actionProcess.running)
            return;
        feedback = args[0] === "copy-url" ? "Copying local URL…" : args[0] === "copy-host" ? "Copying hostname…" : args[0] === "refresh-usage" ? "Refreshing provider limits…" : "Opening Scout…";
        actionFailed = false;
        actionProcess.command = [bin + "scout-menu-action"].concat(args);
        actionProcess.running = true;
    }
    function shortAge(ts) {
        return age(ts).replace(" ago", "");
    }
    function themedLogo(tint) {
        return "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"5 -4 214 244\"><path d=\"M103.01 13.21 Q112 8 120.99 13.21 L198.01 57.79 Q207 63 207 73.39 L207 162.61 Q207 173 198.01 178.21 L120.99 222.79 Q112 228 103.01 222.79 L25.99 178.21 Q17 173 17 162.61 L17 73.39 Q17 63 25.99 57.79 Z\" fill=\"none\" stroke=\"#a7a7a7\" stroke-width=\"24\" stroke-linejoin=\"round\"/><path d=\"M112 70 154 94v48l-42 24-42-24V94Z\" fill=\"#a7a7a7\"/></svg>".replace(/#a7a7a7/g, String(tint)));
    }
    function toggleMenu() {
        menuOpen ? close() : open();
    }
    function uptime() {
        var s = snapshot.uptimeSeconds;
        if (s === null || s === undefined)
            return "—";
        if (s < 3600)
            return Math.floor(s / 60) + "m";
        return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    }

    // Components project broker records; idle agents and trust are not execution/connection states.
    readonly property var capacity: summarizeCapacity(snapshot.budgets || [])
    readonly property var providers: Array.from(new Set((snapshot.budgets || []).map(function (b) {
        return b.provider;
    })))
    readonly property var visibleWork: (snapshot.work || []).filter(function (w) {
        if (todayOnly && (!snapshot.todayStart || !w.ts || w.ts < snapshot.todayStart))
            return false;
        if (workFilter === "Running")
            return !w.blocked && ["completed", "done", "answered", "failed", "cancelled"].indexOf(w.state) < 0;
        if (workFilter === "Done")
            return ["completed", "done", "answered"].indexOf(w.state) >= 0;
        if (workFilter === "Failed")
            return w.state === "failed";
        return true;
    })
    readonly property var latestOutcome: (snapshot.work || []).filter(function (w) {
        return ["completed", "done", "answered", "failed"].indexOf(w.state) >= 0;
    }).slice(0, 1)
    readonly property string attentionTitle: !snapshot.updatedAt ? "Checking in…" : unknown ? "Status unavailable" : !snapshot.brokerUp ? "Scout is offline" : snapshot.needsYouCount > 0 ? snapshot.needsYouCount + (snapshot.needsYouCount === 1 ? " request needs you" : " requests need you") : snapshot.blockedCount > 0 ? "Work is waiting" : "Nothing waiting on you"
    readonly property string attentionDetail: !snapshot.updatedAt ? "Refreshing your local status." : unknown ? "Refresh to try again." : !snapshot.brokerUp ? "Open service details to investigate." : snapshot.needsYouCount > 0 ? "An answer or decision can move work forward." : snapshot.blockedCount > 0 ? "Review the blocker and its next owner." : "No broker-tracked requests are blocked."
    function summarizeCapacity(rows) {
        var groups = {};
        rows.forEach(function (b) {
            if (!groups[b.provider] || (b.used !== null && (groups[b.provider].used === null || b.used > groups[b.provider].used)))
                groups[b.provider] = b;
        });
        return Object.keys(groups).map(function (k) {
            return groups[k];
        }).slice(0, 3);
    }
    function actorName(value) {
        if (!value || value === "system")
            return "Scout";
        if (value === "operator")
            return "You";
        if (value.indexOf("session-") === 0 || value.indexOf("agent-") === 0)
            return "Agent";
        var name = value.split(".")[0];
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
    function count(value) {
        return known(value) ? String(value) : "—";
    }
    function selectWork(filter, today) {
        workFilter = filter;
        todayOnly = !!today;
        tab = "Work";
    }
    function followWork(work) {
        if (work.kind === "flight")
            runAction(["open", "flight", work.id]);
        else if (work.kind === "work" || work.kind === "work_item")
            runAction(["open", "work", work.id]);
        else if (work.conversation)
            runAction(["open", "conversation", work.conversation]);
        else
            runAction(["open", "requests"]);
    }
    function staleBudget(b) {
        return !b.capturedAt || now - b.capturedAt > 900000;
    }
    function machineStatus(m) {
        if (m.self)
            return statusLabel;
        if (m.onlineAt && now - m.onlineAt <= 90000 && m.online !== null)
            return m.online ? "Tailnet online" : "Tailnet offline";
        return m.seenAt ? "Seen " + age(m.seenAt) : "Connection unknown";
    }

    implicitHeight: barSize
    implicitWidth: vertical ? barSize : chip.width + 4

    Component.onCompleted: refresh()
    onMenuOpenChanged: if (!menuOpen && bar)
        bar.hideTooltip(root)
    onTabChanged: body.contentY = 0

    IpcHandler {
        function close(): void {
            root.broadcast("close");
        }
        function refresh(): void {
            root.broadcast("refresh");
        }
        function showTab(name: string): void {
            name = ({
                    Home: "Now",
                    Overview: "Now",
                    Activity: "Work",
                    Budgets: "Usage",
                    Fleet: "Machines"
                })[name] || name;
            if (["Now", "Work", "Usage", "Machines", "Tools"].indexOf(name) < 0)
                return;
            var widget = root.focusedWidget();
            widget.tab = name;
            widget.open();
        }
        function state(): string {
            var widget = root.focusedWidget();
            var win = widget.QsWindow.window;
            return JSON.stringify({
                open: widget.menuOpen,
                tab: widget.tab,
                workFilter: widget.workFilter,
                todayOnly: widget.todayOnly,
                screen: win && win.screen ? win.screen.name : "",
                radius: Style.cornerRadius,
                font: Style.font.body,
                background: String(Color.popups.background),
                updatedAt: widget.snapshot.updatedAt
            });
        }
        function toggle(): void {
            root.focusedWidget().toggleMenu();
        }

        target: "scout.linux"
    }
    Process {
        id: reader

        stdout: StdioCollector {
            onStreamFinished: {
                try {
                    var incoming = JSON.parse(text);
                    if (!incoming.full) {
                        var errors = Object.assign({}, root.snapshot.errors);
                        delete errors.service;
                        delete errors.blocked;
                        incoming.errors = Object.assign(errors, incoming.errors);
                    }
                    root.snapshot = Object.assign({}, root.snapshot, incoming);
                    root.now = Date.now();
                    root.loadError = "";
                } catch (e) {
                    root.loadError = "Status unavailable. Refresh to try again.";
                }
            }
        }

        onExited: function (code) {
            if (code !== 0)
                root.loadError = "Status reader stopped. Refresh to try again.";
            if (root.refreshQueued) {
                root.refreshQueued = false;
                retryRefresh.start();
            }
        }
    }
    Process {
        id: actionProcess

        stdout: StdioCollector {
            onStreamFinished: {
                try {
                    var result = JSON.parse(text);
                    root.feedback = result.message;
                    root.actionFailed = !result.ok;
                    if (result.ok && actionProcess.command[1] === "refresh-usage")
                        root.refresh();
                } catch (e) {
                    root.feedback = "Action unavailable. Please try again.";
                    root.actionFailed = true;
                }
                feedbackTimer.restart();
            }
        }
    }
    Process {
        id: styleProcess

        onExited: function (code) {
            if (code === 0)
                root.snapshot = Object.assign({}, root.snapshot, {
                    appearance: root.pendingStyle
                });
            root.feedback = code === 0 ? "Window style: " + root.pendingStyle : "Could not apply window style";
            root.actionFailed = code !== 0;
            root.pendingStyle = "";
            feedbackTimer.restart();
        }
    }
    Timer {
        id: retryRefresh

        interval: 50

        onTriggered: root.refresh()
    }
    Timer {
        id: feedbackTimer

        interval: 6000

        onTriggered: root.feedback = ""
    }
    Timer {
        interval: 30000
        repeat: true
        running: true

        onTriggered: root.refresh()
    }
    Timer {
        interval: 10000
        repeat: true
        running: root.menuOpen

        onTriggered: root.now = Date.now()
    }
    Shortcut {
        enabled: root.menuOpen
        sequence: "Escape"

        onActivated: root.menuOpen = false
    }
    Rectangle {
        id: chip

        anchors.centerIn: parent
        color: root.menuOpen ? Style.selectedFill : hover.hovered ? Style.hoverFill : "transparent"
        height: Style.space(22)
        radius: Style.cornerRadius
        width: root.snapshot.blockedCount > 0 ? Style.space(36) : Style.space(24)

        Image {
            anchors.verticalCenter: parent.verticalCenter
            fillMode: Image.PreserveAspectFit
            height: Style.space(16)
            smooth: true
            source: root.barLogo
            width: Style.space(14)
            x: Style.space(5)
        }
        Rectangle {
            border.color: root.paper
            border.width: 1
            color: root.statusColor
            height: Style.space(4)
            radius: 2
            visible: !root.unknown && (!root.snapshot.brokerUp || root.snapshot.blockedCount > 0)
            width: Style.space(4)
            x: Style.space(16)
            y: Style.space(16)
        }
        Text {
            anchors.verticalCenter: parent.verticalCenter
            color: root.accent
            font.family: root.mono
            font.pixelSize: Style.font.caption
            text: root.snapshot.blockedCount || ""
            visible: root.snapshot.blockedCount > 0
            x: Style.space(24)
        }
    }
    HoverHandler {
        id: hover

        onHoveredChanged: {
            if (!root.bar)
                return;
            if (hovered && !root.menuOpen)
                root.bar.showTooltip(root, "Scout · " + root.statusLabel + "\nClick for menu · Right-click to open Scout");
            else
                root.bar.hideTooltip(root);
        }
    }
    MouseArea {
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        anchors.fill: parent
        cursorShape: Qt.PointingHandCursor

        onClicked: function (mouse) {
            if (root.bar)
                root.bar.hideTooltip(root);
            if (mouse.button === Qt.RightButton)
                root.launch();
            else
                root.toggleMenu();
        }
    }

    PopupCard {
        id: menu
        anchorItem: root
        bar: root.bar
        owner: root
        open: root.menuOpen
        triggerMode: root.pinned ? "hover" : "click"
        contentWidth: fittedContentWidth(Style.space(448))
        contentHeight: fittedContentHeight(Style.space(740))
        padding: Style.space(18)
        ColumnLayout {
            anchors.fill: parent
            spacing: Style.space(14)
            RowLayout {
                Layout.fillWidth: true
                spacing: Style.space(12)
                Image {
                    source: root.logo
                    Layout.preferredWidth: Style.space(23)
                    Layout.preferredHeight: Style.space(26)
                    fillMode: Image.PreserveAspectFit
                }
                Column {
                    Layout.fillWidth: true
                    spacing: 2
                    Copy {
                        text: "Scout"
                        font.pixelSize: Style.fontPx(1.8)
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.5
                    }
                    Meta {
                        text: (root.snapshot.host || "local") + " / " + (root.unknown ? "checking" : root.snapshot.brokerUp ? "broker running" : "broker stopped")
                    }
                }
                IconButton {
                    icon: "pin"
                    hint: root.pinned ? "Unpin menu" : "Keep menu open"
                    selected: root.pinned
                    onActivated: root.pinned = !root.pinned
                }
                IconButton {
                    icon: "close"
                    hint: "Close menu"
                    onActivated: root.close()
                }
            }
            RowLayout {
                Layout.fillWidth: true
                spacing: Style.space(3)
                Repeater {
                    model: ["Now", "Work", "Usage", "Machines", "Tools"]
                    delegate: TabButton {
                        required property string modelData
                        Layout.fillWidth: true
                        label: modelData
                        selected: root.tab === modelData
                        onActivated: root.tab = modelData
                    }
                }
            }
            Flickable {
                id: body
                Layout.fillWidth: true
                Layout.fillHeight: true
                contentHeight: content.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar {
                    policy: ScrollBar.AsNeeded
                    width: 3
                }
                Column {
                    id: content
                    width: body.width - Style.space(4)
                    spacing: Style.space(18)
                    Copy {
                        width: parent.width
                        text: root.loadError
                        visible: !!root.loadError
                        color: root.danger
                    }
                    Column {
                        width: parent.width
                        spacing: Style.space(18)
                        visible: root.tab === "Now"
                        AttentionCard {
                            width: parent.width
                        }
                        Row {
                            width: parent.width
                            Metric {
                                width: parent.width / 3
                                label: "In progress"
                                value: root.count(root.snapshot.activeCount)
                                onActivated: root.selectWork("Running")
                            }
                            Metric {
                                width: parent.width / 3
                                label: "Done today"
                                value: root.count(root.snapshot.completedToday)
                                onActivated: root.selectWork("Done", true)
                            }
                            Metric {
                                width: parent.width / 3
                                label: "Failed today"
                                value: root.count(root.snapshot.failedToday)
                                onActivated: root.selectWork("Failed", true)
                            }
                        }
                        Column {
                            width: parent.width
                            spacing: Style.space(10)
                            SectionTitle {
                                width: parent.width
                                label: "Capacity"
                                action: "All limits"
                                onActivated: root.tab = "Usage"
                            }
                            Repeater {
                                model: root.capacity
                                delegate: CapacityRow {
                                    required property var modelData
                                    width: parent.width
                                    budget: modelData
                                    onActivated: root.tab = "Usage"
                                }
                            }
                            EmptyState {
                                width: parent.width
                                visible: !root.capacity.length
                                title: reader.running ? "Checking limits…" : "Limits unavailable"
                                detail: "Open providers to inspect your accounts."
                                action: "Open providers"
                                onActivated: root.runAction(["open", "providers"])
                            }
                        }
                        Column {
                            width: parent.width
                            spacing: Style.space(8)
                            SectionTitle {
                                width: parent.width
                                label: (root.snapshot.activeWork || []).length ? "Working now" : "Latest outcome"
                                action: "View work"
                                onActivated: root.selectWork("All")
                            }
                            Repeater {
                                model: (root.snapshot.activeWork || []).length ? root.snapshot.activeWork.slice(0, 1) : root.latestOutcome
                                delegate: WorkRow {
                                    required property var modelData
                                    width: parent.width
                                    work: modelData
                                    compact: true
                                }
                            }
                            Copy {
                                width: parent.width
                                visible: !root.latestOutcome.length
                                text: reader.running ? "Checking work…" : "No tracked outcomes yet."
                                color: root.muted
                            }
                        }
                    }
                    Column {
                        width: parent.width
                        spacing: Style.space(16)
                        visible: root.tab === "Work"
                        Column {
                            width: parent.width
                            spacing: Style.space(8)
                            visible: (root.snapshot.blocked || []).length > 0
                            SectionTitle {
                                width: parent.width
                                label: "Waiting on a next step"
                                action: "Requests"
                                onActivated: root.runAction(["open", "requests"])
                            }
                            Repeater {
                                model: root.snapshot.blocked || []
                                delegate: WorkRow {
                                    required property var modelData
                                    width: parent.width
                                    work: modelData
                                }
                            }
                        }
                        SectionTitle {
                            width: parent.width
                            label: root.todayOnly ? "Today’s work" : "Tracked work"
                            action: root.todayOnly ? "All time" : ""
                            onActivated: root.todayOnly = false
                        }
                        Row {
                            spacing: Style.space(4)
                            Repeater {
                                model: ["All", "Running", "Done", "Failed"]
                                delegate: TabButton {
                                    required property string modelData
                                    label: modelData
                                    selected: root.workFilter === modelData
                                    onActivated: {
                                        root.workFilter = modelData;
                                        root.todayOnly = false;
                                    }
                                }
                            }
                        }
                        Column {
                            width: parent.width
                            spacing: Style.space(4)
                            Repeater {
                                model: root.visibleWork
                                delegate: WorkRow {
                                    required property var modelData
                                    width: parent.width
                                    work: modelData
                                }
                            }
                            EmptyState {
                                width: parent.width
                                visible: !root.visibleWork.length
                                title: root.snapshot.errors.work ? "Work unavailable" : root.workFilter === "Running" ? "No tracked work in progress" : "No work in this view"
                                detail: "Start a request from the action bar below."
                            }
                        }
                        Rule {
                            width: parent.width
                        }
                        SectionTitle {
                            width: parent.width
                            label: "Recent conversations"
                            action: "Messages"
                            onActivated: root.runAction(["open", "inbox"])
                        }
                        TextField {
                            width: parent.width
                            height: Style.space(36)
                            placeholderText: "Filter conversations…"
                            text: root.filter
                            onTextEdited: root.filter = text
                            color: root.ink
                            placeholderTextColor: root.faint
                            font.family: root.sans
                            font.pixelSize: root.bodySize
                            leftPadding: Style.space(10)
                            selectionColor: Style.selectionFill
                            background: Rectangle {
                                color: Style.normalFill
                                border.width: 1
                                border.color: parent.activeFocus ? root.ink : root.line
                                radius: Style.cornerRadius
                            }
                        }
                        Repeater {
                            model: root.filteredActivity
                            delegate: ConversationRow {
                                required property var modelData
                                width: parent.width
                                event: modelData
                            }
                        }
                        Copy {
                            width: parent.width
                            visible: !root.filteredActivity.length
                            text: root.filter ? "No matching conversations." : "No recent conversations."
                            color: root.muted
                        }
                    }
                    Column {
                        width: parent.width
                        spacing: Style.space(20)
                        visible: root.tab === "Usage"
                        SectionTitle {
                            width: parent.width
                            label: "Provider limits"
                            action: "Providers"
                            onActivated: root.runAction(["open", "providers"])
                        }
                        Copy {
                            width: parent.width
                            text: "Remaining capacity across your quota windows."
                            color: root.muted
                        }
                        Repeater {
                            model: root.providers
                            delegate: Column {
                                id: providerGroup
                                required property string modelData
                                width: parent.width
                                spacing: Style.space(12)
                                Copy {
                                    text: providerGroup.modelData
                                    font.pixelSize: Style.fontPx(1.5)
                                    font.weight: Font.Medium
                                }
                                Repeater {
                                    model: (root.snapshot.budgets || []).filter(function (b) {
                                        return b.provider === providerGroup.modelData;
                                    })
                                    delegate: QuotaDetail {
                                        required property var modelData
                                        width: parent.width
                                        budget: modelData
                                    }
                                }
                            }
                        }
                        EmptyState {
                            width: parent.width
                            visible: !root.providers.length
                            title: reader.running ? "Checking limits…" : "No quota data"
                            detail: "Provider accounts can be inspected in Scout."
                            action: "Open providers"
                            onActivated: root.runAction(["open", "providers"])
                        }
                        ActionRow {
                            width: parent.width
                            label: "Refresh provider limits"
                            detail: "Fetch current readings from your accounts"
                            icon: "refresh"
                            enabled: !actionProcess.running
                            onActivated: root.runAction(["refresh-usage"])
                        }
                    }
                    Column {
                        width: parent.width
                        spacing: Style.space(14)
                        visible: root.tab === "Machines"
                        SectionTitle {
                            width: parent.width
                            label: "Your Scout machines"
                            action: "Network"
                            onActivated: root.runAction(["open", "network"])
                        }
                        Copy {
                            width: parent.width
                            text: root.count(root.snapshot.machineCount) + " known · " + root.count(root.snapshot.peerCount) + " trusted peers"
                            color: root.muted
                        }
                        Repeater {
                            model: root.snapshot.machines || []
                            delegate: MachineRow {
                                required property var modelData
                                width: parent.width
                                machine: modelData
                            }
                        }
                        EmptyState {
                            width: parent.width
                            visible: !(root.snapshot.machines || []).length
                            title: reader.running ? "Checking machines…" : "Machine roster unavailable"
                            detail: "Inspect network status in Scout."
                            action: "Open network"
                            onActivated: root.runAction(["open", "network"])
                        }
                        ActionRow {
                            width: parent.width
                            label: "Pair a device"
                            detail: "Open your local pairing controls"
                            icon: "pair"
                            onActivated: root.runAction(["open", "pairing"])
                        }
                    }
                    Column {
                        width: parent.width
                        spacing: Style.space(16)
                        visible: root.tab === "Tools"
                        NotificationControls {
                            width: parent.width
                        }
                        SectionTitle {
                            width: parent.width
                            label: "Jump into Scout"
                        }
                        Column {
                            width: parent.width
                            ActionRow {
                                width: parent.width
                                label: "Messages"
                                detail: "Read replies and continue conversations"
                                icon: "inbox"
                                onActivated: root.runAction(["open", "inbox"])
                            }
                            ActionRow {
                                width: parent.width
                                label: "Sessions"
                                detail: "Inspect observed harness sessions"
                                icon: "terminal"
                                onActivated: root.runAction(["open", "sessions"])
                            }
                            ActionRow {
                                width: parent.width
                                label: "Live tail"
                                detail: "Follow tool calls and harness events"
                                icon: "tail"
                                onActivated: root.runAction(["open", "tail"])
                            }
                            ActionRow {
                                width: parent.width
                                label: "Search"
                                detail: "Find prior work and conversations"
                                icon: "search"
                                onActivated: root.runAction(["open", "search"])
                            }
                            ActionRow {
                                width: parent.width
                                label: "Projects"
                                detail: "Browse agents and project context"
                                icon: "folder"
                                onActivated: root.runAction(["open", "projects"])
                            }
                            ActionRow {
                                width: parent.width
                                label: "Copy local URL"
                                detail: "Put Scout’s address on your clipboard"
                                icon: "copy"
                                onActivated: root.runAction(["copy-url"])
                            }
                        }
                        Rule {
                            width: parent.width
                        }
                        SectionTitle {
                            width: parent.width
                            label: "Window appearance"
                        }
                        Row {
                            spacing: Style.space(8)
                            Repeater {
                                model: ["solid", "subtle", "glass"]
                                delegate: TabButton {
                                    required property string modelData
                                    label: modelData.charAt(0).toUpperCase() + modelData.slice(1)
                                    selected: root.snapshot.appearance === modelData
                                    enabled: !styleProcess.running
                                    onActivated: root.appearance(modelData)
                                }
                            }
                        }
                        SectionTitle {
                            width: parent.width
                            label: "Local service"
                        }
                        Copy {
                            width: parent.width
                            text: root.statusLabel + " · " + root.uptime() + " uptime\n" + (root.known(root.snapshot.memoryMB) ? root.snapshot.memoryMB + " MB" : "Memory unknown") + " · " + root.count(root.snapshot.restarts) + " restarts"
                            color: root.muted
                            lineHeight: 1.4
                        }
                        ActionRow {
                            width: parent.width
                            label: "Service logs"
                            detail: "Inspect the local broker’s journal"
                            icon: "terminal"
                            onActivated: root.logs()
                        }
                    }
                    Column {
                        width: parent.width
                        spacing: Style.space(6)
                        Repeater {
                            model: Object.keys(root.snapshot.errors || {})
                            delegate: Meta {
                                required property string modelData
                                width: parent.width
                                wrapMode: Text.WordWrap
                                text: modelData + ": " + root.snapshot.errors[modelData]
                                color: root.danger
                            }
                        }
                    }
                }
            }
            Rule {
                Layout.fillWidth: true
            }
            RowLayout {
                Layout.fillWidth: true
                spacing: Style.space(8)
                PrimaryAction {
                    label: "New task"
                    icon: "plus"
                    primary: true
                    Layout.fillWidth: true
                    enabled: !actionProcess.running
                    onActivated: root.runAction(["open", "dispatch"])
                }
                PrimaryAction {
                    label: "Open Scout"
                    icon: "arrow"
                    Layout.fillWidth: true
                    onActivated: root.launch()
                }
            }
            RowLayout {
                Layout.fillWidth: true
                spacing: Style.space(4)
                Meta {
                    Layout.fillWidth: true
                    text: root.feedback || (reader.running ? "Refreshing…" : "Updated " + root.age(root.snapshot.updatedAt))
                    color: root.feedback ? root.actionFailed ? root.danger : root.ink : root.faint
                    maximumLineCount: 1
                    elide: Text.ElideRight
                    ToolTip.visible: feedbackHover.hovered && !!root.feedback
                    ToolTip.text: root.feedback
                    HoverHandler {
                        id: feedbackHover
                    }
                }
                Meta {
                    text: "v" + (root.snapshot.version || "—")
                    color: root.faint
                }
                IconButton {
                    icon: "settings"
                    hint: "Scout settings"
                    enabled: !actionProcess.running
                    onActivated: root.runAction(["open", "settings"])
                }
                IconButton {
                    icon: "refresh"
                    hint: "Refresh menu snapshot"
                    enabled: !reader.running
                    onActivated: root.refresh()
                }
            }
        }
    }
    component Copy: Text {
        color: root.ink
        font.family: root.sans
        font.pixelSize: root.bodySize
        textFormat: Text.PlainText
        wrapMode: Text.WordWrap
    }
    component Meta: Copy {
        color: root.faint
        font.family: root.mono
        font.pixelSize: root.captionSize
    }
    component Rule: Rectangle {
        implicitHeight: 1
        height: 1
        color: root.line
    }
    component Glyph: Canvas {
        property string kind: "arrow"
        property color ink: root.muted
        width: Style.space(18)
        height: Style.space(18)
        onKindChanged: requestPaint()
        onInkChanged: requestPaint()
        onWidthChanged: requestPaint()
        onPaint: {
            var c = getContext("2d");
            c.reset();
            c.scale(width / 24, height / 24);
            c.strokeStyle = ink;
            c.lineWidth = 1.4;
            c.lineCap = "round";
            c.lineJoin = "round";
            c.beginPath();
            if (kind === "inbox") {
                c.moveTo(4, 5);
                c.lineTo(20, 5);
                c.lineTo(21, 18);
                c.lineTo(3, 18);
                c.closePath();
                c.moveTo(3, 12);
                c.lineTo(8, 12);
                c.lineTo(10, 15);
                c.lineTo(14, 15);
                c.lineTo(16, 12);
                c.lineTo(21, 12);
            } else if (kind === "tail") {
                c.moveTo(3, 15);
                c.lineTo(7, 15);
                c.lineTo(10, 5);
                c.lineTo(14, 20);
                c.lineTo(17, 10);
                c.lineTo(21, 10);
            } else if (kind === "copy") {
                c.rect(8, 8, 12, 12);
                c.moveTo(5, 16);
                c.lineTo(3, 16);
                c.lineTo(3, 3);
                c.lineTo(16, 3);
                c.lineTo(16, 5);
            } else if (kind === "refresh") {
                c.arc(12, 12, 8, 0.5, 5.4);
                c.moveTo(19, 3);
                c.lineTo(19, 8);
                c.lineTo(14, 8);
            } else if (kind === "pin") {
                c.moveTo(8, 3);
                c.lineTo(16, 3);
                c.moveTo(9, 3);
                c.lineTo(9, 10);
                c.lineTo(6, 14);
                c.lineTo(18, 14);
                c.lineTo(15, 10);
                c.lineTo(15, 3);
                c.moveTo(12, 14);
                c.lineTo(12, 22);
            } else if (kind === "settings") {
                c.arc(12, 12, 4, 0, Math.PI * 2);
                for (var i = 0; i < 8; i++) {
                    var a = i * Math.PI / 4;
                    c.moveTo(12 + 7 * Math.cos(a), 12 + 7 * Math.sin(a));
                    c.lineTo(12 + 10 * Math.cos(a), 12 + 10 * Math.sin(a));
                }
            } else if (kind === "close" || kind === "failed") {
                c.moveTo(6, 6);
                c.lineTo(18, 18);
                c.moveTo(18, 6);
                c.lineTo(6, 18);
            } else if (kind === "check") {
                c.moveTo(5, 12);
                c.lineTo(10, 17);
                c.lineTo(19, 7);
            } else if (kind === "plus") {
                c.moveTo(12, 4);
                c.lineTo(12, 20);
                c.moveTo(4, 12);
                c.lineTo(20, 12);
            } else if (kind === "search") {
                c.arc(10, 10, 6, 0, Math.PI * 2);
                c.moveTo(15, 15);
                c.lineTo(21, 21);
            } else if (kind === "terminal") {
                c.rect(3, 4, 18, 16);
                c.moveTo(7, 9);
                c.lineTo(10, 12);
                c.lineTo(7, 15);
                c.moveTo(13, 15);
                c.lineTo(17, 15);
            } else if (kind === "folder") {
                c.moveTo(3, 7);
                c.lineTo(9, 7);
                c.lineTo(11, 10);
                c.lineTo(21, 10);
                c.lineTo(21, 20);
                c.lineTo(3, 20);
                c.closePath();
                c.moveTo(3, 7);
                c.lineTo(3, 4);
                c.lineTo(10, 4);
                c.lineTo(12, 7);
                c.lineTo(21, 7);
            } else if (kind === "machine") {
                c.rect(3, 4, 18, 13);
                c.moveTo(12, 17);
                c.lineTo(12, 21);
                c.moveTo(7, 21);
                c.lineTo(17, 21);
            } else if (kind === "pair") {
                c.rect(7, 2, 10, 20);
                c.moveTo(11, 18);
                c.lineTo(13, 18);
            } else if (kind === "waiting") {
                c.arc(12, 12, 9, 0, Math.PI * 2);
                c.moveTo(12, 6);
                c.lineTo(12, 12);
                c.lineTo(16, 14);
            } else {
                c.moveTo(6, 18);
                c.lineTo(18, 6);
                c.moveTo(8, 6);
                c.lineTo(18, 6);
                c.lineTo(18, 16);
            }
            c.stroke();
        }
    }
    component IconButton: Rectangle {
        id: button
        property string icon: "arrow"
        property string hint: ""
        property bool selected: false
        signal activated
        implicitWidth: Style.space(28)
        implicitHeight: Style.space(28)
        radius: Style.cornerRadius
        color: selected ? Style.selectedFill : mouse.containsMouse || activeFocus ? root.card : "transparent"
        opacity: enabled ? 1 : 0.35
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: hint
        Keys.onReturnPressed: activated()
        Keys.onSpacePressed: activated()
        Glyph {
            anchors.centerIn: parent
            kind: button.icon
            ink: button.selected || button.activeFocus ? root.ink : root.muted
        }
        ToolTip.visible: mouse.containsMouse
        ToolTip.text: hint
        ToolTip.delay: 500
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: button.activated()
        }
    }
    component TabButton: Rectangle {
        id: button
        property string label: ""
        property bool selected: false
        signal activated
        implicitWidth: text.implicitWidth + Style.space(18)
        implicitHeight: Style.space(32)
        radius: Style.cornerRadius
        color: selected ? Util.alpha(root.ink, 0.08) : mouse.containsMouse || activeFocus ? root.card : "transparent"
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: label
        Keys.onReturnPressed: activated()
        Keys.onSpacePressed: activated()
        Copy {
            id: text
            anchors.centerIn: parent
            text: button.label
            color: button.selected || button.activeFocus ? root.ink : root.muted
            font.weight: button.selected ? Font.DemiBold : Font.Normal
        }
        Rectangle {
            anchors.bottom: parent.bottom
            height: 1
            width: parent.width
            color: root.ink
            visible: button.selected || button.activeFocus
        }
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: button.activated()
        }
    }
    component PrimaryAction: Rectangle {
        id: button
        property string label: ""
        property string icon: "arrow"
        property bool primary: false
        signal activated
        implicitHeight: Style.space(40)
        implicitWidth: Style.space(170)
        color: primary ? root.ink : mouse.containsMouse || activeFocus ? root.card : "transparent"
        border.width: primary ? 0 : 1
        border.color: activeFocus ? root.ink : root.line
        radius: Style.cornerRadius
        opacity: enabled ? 1 : 0.4
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: label
        Keys.onReturnPressed: activated()
        Keys.onSpacePressed: activated()
        Row {
            anchors.centerIn: parent
            spacing: Style.space(8)
            Glyph {
                kind: button.icon
                ink: button.primary ? root.paper : root.ink
                anchors.verticalCenter: parent.verticalCenter
            }
            Copy {
                text: button.label
                color: button.primary ? root.paper : root.ink
                font.weight: Font.DemiBold
                anchors.verticalCenter: parent.verticalCenter
            }
        }
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: button.activated()
        }
    }
    component SectionTitle: Item {
        id: section
        property string label: ""
        property string action: ""
        signal activated
        height: Style.space(22)
        Copy {
            text: section.label
            font.weight: Font.DemiBold
            anchors.verticalCenter: parent.verticalCenter
        }
        Item {
            visible: !!section.action
            anchors.right: parent.right
            height: parent.height
            width: actionText.implicitWidth + Style.space(8)
            activeFocusOnTab: visible
            Accessible.role: Accessible.Button
            Accessible.name: section.action
            Keys.onReturnPressed: section.activated()
            Keys.onSpacePressed: section.activated()
            Copy {
                id: actionText
                anchors.centerIn: parent
                text: section.action + " →"
                color: actionMouse.containsMouse || parent.activeFocus ? root.ink : root.muted
                font.pixelSize: root.bodySize - 1
            }
            MouseArea {
                id: actionMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: section.activated()
            }
        }
    }
    component AttentionCard: Rectangle {
        id: attention
        height: Style.space(102)
        color: Util.alpha(root.ink, 0.035)
        border.width: 1
        border.color: root.line
        radius: Style.cornerRadius
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: root.attentionTitle + ". " + root.attentionDetail
        function activate() {
            if (!root.unknown && !root.snapshot.brokerUp)
                root.tab = "Tools";
            else
                root.tab = "Work";
        }
        Keys.onReturnPressed: activate()
        Keys.onSpacePressed: activate()
        Glyph {
            x: Style.space(14)
            y: Style.space(14)
            kind: root.unknown || root.snapshot.blockedCount > 0 ? "waiting" : !root.snapshot.brokerUp ? "failed" : "check"
            width: Style.space(22)
            height: width
            ink: root.muted
        }
        Meta {
            x: Style.space(46)
            y: Style.space(19)
            text: "ATTENTION"
            font.pixelSize: root.captionSize
            font.letterSpacing: 1.2
        }
        Copy {
            x: Style.space(16)
            y: Style.space(44)
            width: parent.width - Style.space(32)
            text: root.attentionTitle
            font.pixelSize: Style.fontPx(1.8)
            font.weight: Font.Medium
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        Copy {
            x: Style.space(16)
            y: Style.space(76)
            width: parent.width - Style.space(32)
            text: root.attentionDetail
            color: root.muted
            font.pixelSize: root.bodySize - 1
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        Rectangle {
            anchors.fill: parent
            color: "transparent"
            border.width: 1
            border.color: root.ink
            visible: attention.activeFocus
        }
        MouseArea {
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: attention.activate()
        }
    }
    component Metric: Rectangle {
        id: metric
        property string label: ""
        property string value: "—"
        signal activated
        height: Style.space(62)
        color: mouse.containsMouse || activeFocus ? root.card : "transparent"
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: value + " " + label
        Keys.onReturnPressed: activated()
        Keys.onSpacePressed: activated()
        Copy {
            x: Style.space(6)
            y: Style.space(2)
            text: metric.value
            font.pixelSize: Style.fontPx(2.6)
            font.weight: Font.Light
        }
        Copy {
            x: Style.space(6)
            y: Style.space(42)
            width: parent.width - Style.space(10)
            text: metric.label
            color: root.muted
            font.pixelSize: root.bodySize - 1
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: metric.activated()
        }
    }
    component CapacityRow: Rectangle {
        id: row
        property var budget: ({})
        signal activated
        height: Style.space(44)
        color: mouse.containsMouse || activeFocus ? root.card : "transparent"
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: budget.provider + ", " + (budget.used === null ? "unknown capacity" : Math.round(100 - budget.used) + " percent remaining")
        Keys.onReturnPressed: activated()
        Keys.onSpacePressed: activated()
        Copy {
            x: Style.space(2)
            text: row.budget.provider || "Provider"
            font.weight: Font.Medium
        }
        Meta {
            x: Style.space(80)
            y: 2
            width: parent.width - Style.space(170)
            text: row.budget.window + (root.staleBudget(row.budget) ? " · cached" : "")
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        Copy {
            anchors.right: parent.right
            anchors.rightMargin: Style.space(2)
            text: row.budget.used === null ? "Unknown" : Math.round(100 - row.budget.used) + "% left"
            color: root.muted
            font.pixelSize: root.bodySize - 1
        }
        Rectangle {
            x: Style.space(2)
            y: Style.space(26)
            width: parent.width - Style.space(4)
            height: Style.space(3)
            color: root.line
            Rectangle {
                width: parent.width * (row.budget.used === null ? 0 : (100 - row.budget.used) / 100)
                height: parent.height
                color: root.ink
                opacity: root.staleBudget(row.budget) ? 0.38 : 0.75
            }
        }
        ToolTip.visible: mouse.containsMouse
        ToolTip.text: "Most constrained window · resets " + budget.reset + " · " + root.age(budget.capturedAt)
        ToolTip.delay: 500
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: row.activated()
        }
    }
    component WorkRow: Rectangle {
        id: row
        property var work: ({})
        property bool compact: false
        height: title.implicitHeight + Style.space(compact ? 30 : 36)
        color: mouse.containsMouse || activeFocus ? root.card : "transparent"
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: work.state + ". " + work.title
        Keys.onReturnPressed: root.followWork(work)
        Keys.onSpacePressed: root.followWork(work)
        Glyph {
            x: Style.space(4)
            y: Style.space(8)
            kind: row.work.blocked ? "waiting" : row.work.state === "failed" ? "failed" : ["completed", "done", "answered"].indexOf(row.work.state) >= 0 ? "check" : "tail"
            ink: root.muted
        }
        Copy {
            x: Style.space(30)
            y: Style.space(3)
            width: parent.width - Style.space(95)
            text: root.actorName(row.work.actor) + " · " + (row.work.blocked ? "waiting on " + (row.work.nextActor || "unknown") : row.work.state)
            color: root.muted
            font.pixelSize: root.bodySize - 1
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        Meta {
            anchors.right: parent.right
            y: Style.space(4)
            text: root.shortAge(row.work.ts)
        }
        Copy {
            id: title
            x: Style.space(30)
            y: Style.space(22)
            width: parent.width - x - Style.space(5)
            text: row.work.title || "Tracked work"
            maximumLineCount: row.compact ? 2 : 3
            elide: Text.ElideRight
            lineHeight: 1.2
        }
        ToolTip.visible: mouse.containsMouse
        ToolTip.text: work.title + (work.reason ? "\n" + work.reason : "")
        ToolTip.delay: 650
        Rule {
            anchors.bottom: parent.bottom
            width: parent.width
            opacity: 0.5
        }
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.followWork(row.work)
        }
    }
    component ConversationRow: Rectangle {
        id: row
        property var event: ({})
        height: title.implicitHeight + Style.space(34)
        color: mouse.containsMouse || activeFocus ? root.card : "transparent"
        activeFocusOnTab: !!event.conversation
        Accessible.role: event.conversation ? Accessible.Button : Accessible.StaticText
        Accessible.name: event.title || ""
        function activate() {
            if (event.conversation)
                root.runAction(["open", "conversation", event.conversation]);
        }
        Keys.onReturnPressed: activate()
        Keys.onSpacePressed: activate()
        Copy {
            x: 4
            y: 4
            width: parent.width - Style.space(65)
            text: root.actorName(row.event.actor)
            color: root.muted
            font.pixelSize: root.bodySize - 1
        }
        Meta {
            anchors.right: parent.right
            y: 4
            text: root.shortAge(row.event.ts)
        }
        Copy {
            id: title
            x: 4
            y: Style.space(23)
            width: parent.width - 8
            text: row.event.title || ""
            maximumLineCount: 3
            elide: Text.ElideRight
            lineHeight: 1.2
        }
        Rule {
            anchors.bottom: parent.bottom
            width: parent.width
            opacity: 0.5
        }
        ToolTip.visible: mouse.containsMouse
        ToolTip.text: event.title || ""
        ToolTip.delay: 650
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: row.event.conversation ? Qt.PointingHandCursor : Qt.ArrowCursor
            onClicked: row.activate()
        }
    }
    component QuotaDetail: Column {
        id: row
        property var budget: ({})
        spacing: Style.space(8)
        RowLayout {
            width: parent.width
            Copy {
                text: row.budget.window || "Quota window"
                color: root.muted
                Layout.fillWidth: true
            }
            Copy {
                text: row.budget.used === null ? "Unknown" : Math.round(100 - row.budget.used) + "% remaining"
                font.pixelSize: Style.fontPx(1.45)
            }
        }
        Rectangle {
            width: parent.width
            height: Style.space(4)
            color: root.line
            Rectangle {
                width: parent.width * (row.budget.used === null ? 0 : (100 - row.budget.used) / 100)
                height: parent.height
                color: root.ink
                opacity: root.staleBudget(row.budget) ? 0.4 : 0.85
            }
        }
        Copy {
            width: parent.width
            text: "Resets " + row.budget.reset
            color: root.muted
            font.pixelSize: root.bodySize - 1
        }
        Meta {
            width: parent.width
            text: (root.staleBudget(row.budget) ? "Cached · " : "Captured · ") + root.age(row.budget.capturedAt)
            color: root.faint
        }
    }
    component MachineRow: Rectangle {
        id: row
        property var machine: ({})
        height: Style.space(65)
        color: mouse.containsMouse || activeFocus ? root.card : "transparent"
        activeFocusOnTab: true
        Accessible.role: Accessible.Button
        Accessible.name: machine.name + ". " + root.machineStatus(machine)
        Keys.onReturnPressed: root.runAction(["open", "network"])
        Keys.onSpacePressed: root.runAction(["open", "network"])
        Glyph {
            x: Style.space(4)
            y: Style.space(14)
            kind: "machine"
            ink: row.machine.self || row.machine.trusted ? root.ink : root.faint
        }
        Copy {
            x: Style.space(32)
            y: Style.space(8)
            width: parent.width - Style.space(66)
            text: row.machine.name + (row.machine.self ? " · This machine" : "")
            font.weight: Font.Medium
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        Copy {
            x: Style.space(32)
            y: Style.space(30)
            width: parent.width - Style.space(68)
            text: root.machineStatus(row.machine) + (row.machine.trusted ? " · Trusted " + row.machine.tier : row.machine.self ? "" : " · Discovered")
            color: root.muted
            font.pixelSize: root.bodySize - 1
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        Rule {
            anchors.bottom: parent.bottom
            width: parent.width
            opacity: 0.5
        }
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.runAction(["open", "network"])
        }
        IconButton {
            anchors.right: parent.right
            y: Style.space(15)
            icon: "copy"
            hint: "Copy " + row.machine.hostname + " hostname"
            onActivated: root.runAction(["copy-host", row.machine.hostname])
        }
    }
    component ActionRow: Rectangle {
        id: row
        property string label: ""
        property string detail: ""
        property string icon: "arrow"
        signal activated
        implicitHeight: Style.space(57)
        height: implicitHeight
        color: mouse.containsMouse || activeFocus ? root.card : "transparent"
        activeFocusOnTab: true
        opacity: enabled ? 1 : 0.4
        Accessible.role: Accessible.Button
        Accessible.name: label + ". " + detail
        Keys.onReturnPressed: activated()
        Keys.onSpacePressed: activated()
        Glyph {
            x: Style.space(4)
            anchors.verticalCenter: parent.verticalCenter
            kind: row.icon
            ink: root.muted
        }
        Copy {
            x: Style.space(34)
            y: Style.space(8)
            text: row.label
            font.weight: Font.Medium
        }
        Copy {
            x: Style.space(34)
            y: Style.space(29)
            width: parent.width - x - Style.space(10)
            text: row.detail
            color: root.muted
            font.pixelSize: root.bodySize - 1
            maximumLineCount: 1
            elide: Text.ElideRight
        }
        Rule {
            anchors.bottom: parent.bottom
            width: parent.width
            opacity: 0.5
        }
        MouseArea {
            id: mouse
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: row.activated()
        }
    }
    component EmptyState: Column {
        id: empty
        property string title: ""
        property string detail: ""
        property string action: ""
        signal activated
        spacing: Style.space(8)
        Copy {
            width: parent.width
            text: empty.title
            font.weight: Font.Medium
        }
        Copy {
            width: parent.width
            text: empty.detail
            color: root.muted
            visible: !!empty.detail
        }
        TabButton {
            label: empty.action
            visible: !!empty.action
            onActivated: empty.activated()
        }
    }
}
