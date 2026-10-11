/**
 * World · Modale — the one command registry.
 *
 * Every move the HUD can make is one entry here: an id, a group, its ":" syntax, the keys bound to it (and in which
 * panel), the words voice answers to, and one line saying what it does. The engine attaches a handler per id; the
 * keyboard, the ":" palette, tours, the "?" sheet, the footer strip and the voice resolver (server/world-command.ts)
 * all read this list. Nothing exists only as a key.
 *
 * Pure on purpose (no DOM, no engine state) so the rules can be tested: unique keys per scope, a handler and a
 * description for every entry, a ":" grammar every bound key's line passes.
 */

export const GROUPS = ["Time", "Camera", "View", "Window", "Filter", "Source", "Theme", "Errors", "Act", "Inspect", "Panels", "Tour", "Help"] as const;
export type Group = (typeof GROUPS)[number];

/** Where a key works: everywhere, while a panel is focused (its badge letter), over an open file preview, or zeroed in. */
export type Scope = "global" | "preview" | "work" | "ps" | "frozen" | "w" | "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "j" | "l" | "q" | "s" | "v" | "x";
export const SCOPE_NAME: Record<string, string> = {
  global: "GLOBAL", preview: "FILE PREVIEW", work: "ZEROED IN", ps: "POINT & SPEAK", frozen: "FROZEN", s: "STASH", w: "WORLD", a: "REPLAY", b: "ROSTER", c: "LANES", q: "QUOTA",
  l: "TIMELINE", d: "TIME TO DONE", e: "ACTIVITY", f: "RHYTHM", g: "MESH", h: "OUTCOMES", j: "LOG", v: "CODE", x: "INSPECT",
};

/**
 * One key binding. `k` are KeyboardEvent keys as typed ("n", "N", "?", "ArrowLeft"); a named key with shift held is
 * written "S-ArrowLeft". `arg` is what the key passes to the handler, so a key is always a ":" line too.
 * `hold` keys act while held (turn, zoom); `:` runs them once.
 */
export type KeyBind = { k: string[]; arg?: string; scope?: Scope | Scope[]; hold?: boolean; label?: string };

export type Voice = {
  /** the server resolver's verb (world-command.ts WORLD_VERBS) that lands on this command */
  verb?: string;
  /** what an operator says; the fallback parser is tested against every one of these. A [phrase, line] pair runs that
   *  line; a bare phrase runs `line` (commands with no verb) or whatever the verb's parser makes of it */
  phrases: (string | [string, string])[];
  /** Jev's description of the verb (the one choice it picks between); defaults to desc */
  choice?: string;
  /** the ":" line a phrase runs when there is no verb (phrase match only) */
  line?: string;
};

export type CommandSpec = {
  id: string;
  group: Group;
  /** the verb and its aliases; the first is canonical */
  names: string[];
  /** regex source for everything after the verb, including leading whitespace ("" = no arguments) */
  tail: string;
  /** how the syntax reads in the palette and the sheet */
  syntax: string;
  /** argument completions the palette offers after the verb */
  args?: string[];
  keys?: KeyBind[];
  voice?: Voice;
  desc: string;
  /** shown in the footer strip in GLOBAL (lower first) */
  essential?: number;
  /** false: a literal line is never passed straight through by the voice resolver (names go through fuzzy matching) */
  literal?: boolean;
};

const DOWS = "sun|mon|tue|wed|thu|fri|sat";
const ON_OFF = "(\\s+(on|off))?";

export const COMMANDS: CommandSpec[] = [
  /* ---------------- Time ---------------- */
  { id: "play", group: "Time", names: ["play"], tail: "(\\s+(toggle))?", syntax: ":play [toggle]", args: ["toggle"],
    keys: [{ k: [" "], arg: "toggle", label: "SPC" }], essential: 1, desc: "Play the replay (toggle: play or pause).",
    voice: { verb: "play", phrases: ["play", "resume", "keep going", "start the replay"], choice: "Start or resume the replay." } },
  { id: "pause", group: "Time", names: ["pause"], tail: "", syntax: ":pause", desc: "Pause the replay; paused, the world is a slice.",
    voice: { verb: "pause", phrases: ["pause", "hold it"], choice: "Pause the replay." } },
  { id: "goto", group: "Time", names: ["goto", "g", "t"], syntax: ":goto wed 14:00 · -2d · +1h · now · start",
    tail: `\\s+(now|start|end|[+-]\\d+(\\.\\d+)?[dhm]|@\\d{10,}|((${DOWS})\\s*)?\\d{1,2}(:\\d{2})?|${DOWS})`,
    args: ["now", "start", "-1h", "+1h", "-1d", "+1d", "mon", "tue", "wed", "thu", "fri", "sat", "sun", "wed 14:00"],
    keys: [
      { k: ["}"], arg: "+1h" }, { k: ["{"], arg: "-1h" }, { k: [">"], arg: "+1d" }, { k: ["<"], arg: "-1d" },
      { k: ["Home"], arg: "start" }, { k: ["End"], arg: "end" },
      { k: ["ArrowRight"], arg: "+1h", scope: ["a", "e", "l"] }, { k: ["ArrowLeft"], arg: "-1h", scope: ["a", "e", "l"] },
      { k: ["S-ArrowRight"], arg: "+1d", scope: ["a", "e", "l"] }, { k: ["S-ArrowLeft"], arg: "-1d", scope: ["a", "e", "l"] },
    ],
    desc: "Move the playhead: a day and time, a step, the start or now (end: now, and paused on the snapshot).",
    voice: { verb: "goto", phrases: ["wednesday afternoon", "an hour ago", "back two hours", "end of the week", "go to monday at 9am"],
      choice: "Move the playhead to a time or day (\"wednesday afternoon\", \"an hour ago\", \"back two hours\", \"end of week\")." } },
  { id: "speed", group: "Time", names: ["speed", "s"], syntax: ":speed 4 · 1h/s · 10m/s · realtime · faster · slower",
    tail: "\\s+(\\d+(\\.\\d+)?|\\d+(\\.\\d+)?\\s*[smhd]\\s*\\/\\s*s|realtime|faster|slower)", args: ["faster", "slower", "1", "2", "4", "8", "1h/s", "10m/s", "realtime"],
    keys: [{ k: ["."], arg: "faster" }, { k: [","], arg: "slower" }], desc: "Replay speed: a multiple, a rate (1h/s), realtime, or one step faster or slower.",
    voice: { verb: "speed", phrases: ["faster", "slow down", "speed 4", "double time"], choice: "Change the replay speed (faster, slower, a multiple)." } },
  { id: "ask", group: "Time", names: ["ask"], tail: "(\\s+\\S.*)?", syntax: ":ask next · prev · <words>", args: ["next", "prev"], literal: false,
    keys: [{ k: [")"], arg: "next" }, { k: ["("], arg: "prev" }, { k: ["a"], scope: "ps" }],
    desc: "Step the playhead to the next or previous ask; or, with something pointed at, Ask it through Scout (traced): words go to review first.",
    voice: { phrases: [["next ask", "ask next"], ["previous ask", "ask prev"]] } },
  { id: "slice", group: "Time", names: ["slice"], tail: "\\s+[+-](20m|1h)", syntax: ":slice +20m · -20m · +1h · -1h", args: ["+20m", "-20m", "+1h", "-1h"],
    keys: [{ k: ["l"], arg: "+20m", scope: "w" }, { k: ["h"], arg: "-20m", scope: "w" }, { k: ["L"], arg: "+1h", scope: "w" }, { k: ["H"], arg: "-1h", scope: "w" }],
    desc: "Pause and move the slice: what was happening 20 minutes (or an hour) later or earlier.",
    voice: { phrases: [["next slice", "slice +20m"], ["previous slice", "slice -20m"]] } },
  { id: "stack", group: "Time", names: ["stack"], tail: "\\s+(next|prev)", syntax: ":stack next · prev", args: ["next", "prev"],
    keys: [{ k: ["ArrowDown"], arg: "next", scope: ["e", "l"] }, { k: ["ArrowUp"], arg: "prev", scope: ["e", "l"] }],
    desc: "Open the next or previous time panel (timeline, activity, rhythm); the others stay as strips.",
    voice: { phrases: [["next time panel", "stack next"], ["previous time panel", "stack prev"]] } },

  /* ---------------- Camera ---------------- */
  { id: "turn", group: "Camera", names: ["turn"], tail: "\\s+(left|right)", syntax: ":turn left · right", args: ["left", "right"],
    keys: [{ k: ["z", "Z"], arg: "left", hold: true }, { k: ["x", "X"], arg: "right", hold: true }], essential: 2,
    desc: "Turn the world (hold Z or X; shift turns faster).", voice: { phrases: [["turn left", "turn left"], ["turn right", "turn right"]] } },
  { id: "zoom", group: "Camera", names: ["zoom"], tail: "\\s+(in|out)", syntax: ":zoom in · out", args: ["in", "out"],
    keys: [{ k: ["c", "C"], arg: "out", hold: true }, { k: ["v", "V"], arg: "in", hold: true }], essential: 3,
    desc: "Zoom the camera (hold C or V).", voice: { phrases: [["zoom in", "zoom in"], ["zoom out", "zoom out"]] } },
  { id: "view", group: "Camera", names: ["view", "v"], tail: "\\s+(iso|top|side|low)", syntax: ":view iso · top · side · low", args: ["iso", "top", "side", "low"],
    desc: "Camera angle.", voice: { verb: "view", phrases: ["top view", "from above", "side view", "isometric"], choice: "Change the camera angle: top, side, iso or low." } },
  { id: "pan", group: "Camera", names: ["pan"], tail: "\\s+(left|right|up|down)", syntax: ":pan left · right · up · down", args: ["left", "right", "up", "down"],
    keys: [{ k: ["ArrowLeft"], arg: "left", scope: "w" }, { k: ["ArrowRight"], arg: "right", scope: "w" }, { k: ["ArrowUp"], arg: "up", scope: "w" }, { k: ["ArrowDown"], arg: "down", scope: "w" }],
    desc: "Pan the world a fifth of the view.", voice: { phrases: [["pan left", "pan left"], ["pan right", "pan right"], ["pan up", "pan up"], ["pan down", "pan down"]] } },
  { id: "orbit", group: "Camera", names: ["orbit"], tail: "\\s+(left|right|up|down)", syntax: ":orbit left · right · up · down", args: ["left", "right", "up", "down"],
    keys: [{ k: ["S-ArrowLeft"], arg: "left", scope: "w" }, { k: ["S-ArrowRight"], arg: "right", scope: "w" }, { k: ["S-ArrowUp"], arg: "up", scope: "w" }, { k: ["S-ArrowDown"], arg: "down", scope: "w" }],
    desc: "Orbit or tilt the camera a step.", voice: { phrases: [["orbit left", "orbit left"], ["orbit right", "orbit right"], ["tilt up", "orbit up"], ["tilt down", "orbit down"]] } },
  { id: "level", group: "Camera", names: ["level"], tail: "\\s+(in|out)", syntax: ":level in · out", args: ["in", "out"],
    keys: [{ k: ["+", "="], arg: "in", scope: "w" }, { k: ["-", "_"], arg: "out", scope: "w" }],
    desc: "One camera rung closer or farther: WEEK · 2 DAYS · DAY · 6 H · 2 H.", voice: { phrases: [["closer", "level in"], ["get closer", "level in"], ["farther", "level out"], ["pull back", "level out"]] } },
  { id: "follow", group: "Camera", names: ["follow"], tail: ON_OFF, syntax: ":follow [on|off]", args: ["on", "off"],
    keys: [{ k: ["F"], scope: "w" }], desc: "The camera follows the playhead (⇧F; F alone freezes the frame).", voice: { phrases: [["follow the playhead", "follow on"], ["stop following", "follow off"]] } },
  { id: "center", group: "Camera", names: ["center"], tail: "", syntax: ":center", keys: [{ k: ["R"], scope: "w" }],
    desc: "Bring the playhead to the middle of the world.", voice: { phrases: [["center", "center"], ["center on the playhead", "center"]] } },
  { id: "reset", group: "Camera", names: ["reset"], tail: "", syntax: ":reset", keys: [{ k: ["r"], scope: "w" }],
    desc: "Camera back to the whole week.", voice: { phrases: [["reset the camera", "reset"], ["camera home", "reset"]] } },
  { id: "height", group: "Camera", names: ["height"], tail: "\\s+(up|down)", syntax: ":height up · down", args: ["up", "down"],
    keys: [{ k: ["y"], arg: "up", scope: "w" }, { k: ["Y"], arg: "down", scope: "w" }], desc: "Taller or flatter stacks.",
    voice: { phrases: [["taller stacks", "height up"], ["flatter stacks", "height down"]] } },
  { id: "pin", group: "Camera", names: ["pin"], tail: "\\s+(next|prev)", syntax: ":pin next · prev", args: ["next", "prev"],
    keys: [{ k: ["p"], arg: "next", scope: "w" }, { k: ["P"], arg: "prev", scope: "w" }], desc: "Select the next or previous pinned ask (Enter flies to it).",
    voice: { phrases: [["next pin", "pin next"], ["previous pin", "pin prev"]] } },
  { id: "find", group: "Camera", names: ["find", "f"], tail: "\\s+\\S.*", syntax: ":find <agent>", literal: false,
    desc: "Fly the camera to one agent from the roster.",
    voice: { verb: "find", phrases: ["find devon", "where is hypatia", "fly to galileo"], choice: "Fly the camera to one named agent from the roster." } },
  { id: "fly", group: "Camera", names: ["fly"], tail: "\\s+\\S.*", syntax: ":fly <camera words> [over 3s]", desc: "Fly the camera to a spot written as words (tours use this; :cam prints the current one)." },
  { id: "cam", group: "Camera", names: ["cam"], tail: "(\\s+\\S.*)?", syntax: ":cam [save|go|rm|list] <name>", args: ["list", "save ", "go ", "rm "],
    desc: "Saved cameras: print this one, save it by name, fly to one, remove one, list them." },
  { id: "mesh", group: "Camera", names: ["mesh"], tail: "\\s+(left|right|up|down|in|out|reset)", syntax: ":mesh left · right · up · down · in · out · reset",
    args: ["left", "right", "up", "down", "in", "out", "reset"],
    keys: [{ k: ["ArrowLeft", "S-ArrowLeft"], arg: "left", scope: "g" }, { k: ["ArrowRight", "S-ArrowRight"], arg: "right", scope: "g" },
      { k: ["ArrowUp", "S-ArrowUp"], arg: "up", scope: "g" }, { k: ["ArrowDown", "S-ArrowDown"], arg: "down", scope: "g" },
      { k: ["+", "="], arg: "in", scope: "g" }, { k: ["-"], arg: "out", scope: "g" }, { k: ["r", "R"], arg: "reset", scope: "g" }],
    desc: "Turn, tilt or zoom the mesh panel's globe." },

  /* ---------------- View ---------------- */
  { id: "lift", group: "View", names: ["lift"], tail: ON_OFF, syntax: ":lift [on|off]", args: ["on", "off"], keys: [{ k: ["u", "U"] }],
    desc: "Artifacts up: files rise above the sessions, pages and images glow.", voice: { phrases: [["artifacts up", "lift on"], ["lift the files", "lift on"], ["artifacts down", "lift off"]] } },
  { id: "cluster", group: "View", names: ["cluster"], tail: "", syntax: ":cluster", keys: [{ k: ["o", "O"] }],
    desc: "Cluster lifted files by type: tight, normal, loose.", voice: { phrases: [["cluster the files", "cluster"]] } },
  { id: "lens", group: "View", names: ["lens"], tail: "(\\s+(all|sessions|scout|worktrees|next))?", syntax: ":lens all · sessions · scout · worktrees", args: ["all", "sessions", "scout", "worktrees"],
    keys: [{ k: ["m", "M"], arg: "next" }], desc: "Lens: everything, native sessions, Scout asks and the sessions that took them, or work in worktrees.",
    voice: { phrases: [["next lens", "lens next"], ["scout lens", "lens scout"], ["worktrees lens", "lens worktrees"], ["sessions lens", "lens sessions"], ["show everything", "lens all"]] } },
  { id: "filters", group: "View", names: ["filters"], tail: ON_OFF, syntax: ":filters [on|off]", args: ["on", "off"], keys: [{ k: ["\\"] }],
    desc: "Show or hide the filter row (SHOW · LENS · FILES).", voice: { phrases: [["show the filters", "filters on"], ["hide the filters", "filters off"]] } },
  { id: "chatter", group: "View", names: ["chatter"], tail: ON_OFF, syntax: ":chatter [on|off]", args: ["on", "off"],
    desc: "Message text drifting by the lanes; off, hovering still tags.", voice: { phrases: [["chatter on", "chatter on"], ["chatter off", "chatter off"], ["quiet the chatter", "chatter off"]] } },
  { id: "guides", group: "View", names: ["guides"], tail: ON_OFF, syntax: ":guides [on|off]", args: ["on", "off"],
    desc: "Layout guides over the world: the edges the HUD uses (solid = shared, dashed = alone) on an 8px grid." },
  { id: "order", group: "View", names: ["order"], tail: "(\\s+(live|fixed))?", syntax: ":order live · fixed", args: ["live", "fixed"],
    desc: "Lane order: busiest at the centre (live) or the week's own order (fixed)." },
  { id: "roster", group: "View", names: ["roster"], tail: "(\\s+(asked|burn))?", syntax: ":roster asked · burn", args: ["asked", "burn"],
    keys: [{ k: ["b"], scope: "b" }], desc: "Roster: who was asked, or what each agent burned (tokens, cache, cold restarts).",
    voice: { phrases: [["show the burn", "roster burn"], ["who was asked", "roster asked"]] } },

  /* ---------------- Window ---------------- */
  { id: "window", group: "Window", names: ["window"], tail: "(\\s+(live|5m|30m|4h|24h|all|off|none|wider|narrower|in|out|[1-6]))?",
    syntax: ":window live · 5m · 30m · 4h · 24h · all · wider · narrower · off", args: ["live", "5m", "30m", "4h", "24h", "all", "wider", "narrower", "off"],
    keys: [...["live", "5m", "30m", "4h", "24h", "all"].map((a, i) => ({ k: [String(i + 1)], arg: a, label: "1–6" })),
      { k: ["]"], arg: "wider" }, { k: ["["], arg: "narrower" }, { k: ["0"], arg: "off" }], essential: 4,
    desc: "The time window: short windows are the World, 4h folds sessions into lanes, 24h and all fold lanes into machines (the Mesh).",
    voice: { verb: "window", phrases: ["the last four hours", "show the mesh", "widen the window", "close the window"],
      choice: "Change the time window: the last minute, 5 minutes, 30 minutes, 4 hours, 24 hours or the whole week (the machine mesh); wider, narrower or closed." } },

  /* ---------------- Filter ---------------- */
  { id: "lane", group: "Filter", names: ["lane", "l"], tail: "(\\s+\\S.*)?", syntax: ":lane <name> · all", args: ["all"], literal: false,
    keys: [{ k: ["0"], arg: "all", scope: "c" }], desc: "Solo one workspace lane, or show every lane again.",
    voice: { verb: "lane", phrases: ["solo the web lane", "show all lanes"], choice: "Solo one workspace lane, or show all lanes again." } },
  { id: "solo", group: "Filter", names: ["solo"], tail: "\\s+\\S.*", syntax: ":solo host <name> · off", args: ["host ", "off"],
    desc: "Solo one machine (its lanes and arcs), or every machine again." },
  { id: "select", group: "Filter", names: ["select"], tail: "\\s+\\S.*", syntax: ":select worktree <name> · off", args: ["worktree ", "off"],
    desc: "Pin one worktree in the code panel." },

  /* ---------------- Source ---------------- */
  { id: "source", group: "Source", names: ["source"], tail: "(\\s+(week|live|otlp))?", syntax: ":source week · live · otlp", args: ["week", "live", "otlp"],
    desc: "Where the world comes from: the snapshot week, our machines live, or only what OTLP exporters send.",
    voice: { verb: "source", phrases: ["go live", "switch to otlp", "back to the snapshot"],
      choice: "Switch where the world comes from: the recorded week (snapshot), live from our machines, or only what OTLP exporters send." } },

  /* ---------------- Theme ---------------- */
  { id: "theme", group: "Theme", names: ["theme"], tail: "(\\s+(paper|linen|ember|dusk|scout|next))?", syntax: ":theme paper · linen · ember · dusk · scout",
    args: ["paper", "linen", "ember", "dusk", "scout", "next"], keys: [{ k: [";"], arg: "next" }], essential: 8,
    desc: "The treatment: paper and linen are light grounds, ember and dusk warm darks, scout the default.",
    voice: { verb: "theme", phrases: ["switch to paper", "ember theme", "light mode", "go dark"],
      choice: "Change the look (treatment): paper, linen, ember, dusk or scout; light mode, dark mode, or the next one." } },
  { id: "accent", group: "Theme", names: ["accent"], tail: "(\\s+(amber|emerald|cobalt|vermilion|violet|graphite|next|default))?",
    syntax: ":accent amber · emerald · cobalt · vermilion · violet · graphite · default", args: ["amber", "emerald", "cobalt", "vermilion", "violet", "graphite", "default", "next"],
    keys: [{ k: ["'"], arg: "next" }], desc: "The accent colour, or back to the treatment's own.",
    voice: { verb: "accent", phrases: ["make the accent cobalt", "reset the accent"],
      choice: "Change the accent colour: amber, emerald, cobalt, vermilion, violet or graphite, or back to the theme's own." } },

  /* ---------------- Errors ---------------- */
  { id: "errors", group: "Errors", names: ["errors"], tail: ON_OFF, syntax: ":errors [on|off]", args: ["on", "off"],
    desc: "Dim the world to what failed or is stuck: failed asks, undelivered messages, tool calls that errored.",
    voice: { verb: "errors", phrases: ["show me errors", "what's broken", "hide the errors"],
      choice: "Show what went wrong: failed asks, undelivered messages, tool calls that errored, and anything stuck (\"show me errors\", \"what's broken\"). Or hide that view again." } },
  { id: "trouble", group: "Errors", names: ["trouble"], tail: "\\s+(next|prev)", syntax: ":trouble next · prev", args: ["next", "prev"],
    keys: [{ k: ["n"], arg: "next" }, { k: ["N"], arg: "prev" }], essential: 5,
    desc: "Fly to the next or previous failed or stuck item (only on the key: LIVE never moves the camera by itself).",
    voice: { phrases: [["next failure", "trouble next"], ["next stuck one", "trouble next"], ["previous failure", "trouble prev"]] } },
  { id: "stuck", group: "Errors", names: ["stuck"], tail: "(\\s+\\d+(\\.\\d+)?\\s*(m|min|h|hr)?(\\s+\\d+(\\.\\d+)?\\s*(m|h|d))?)?", syntax: ":stuck 10m · 30m · 1h [24h]", args: ["10m", "30m", "1h", "30m 24h", "30m 3d"],
    desc: "How long an ask or message stays open before it counts as stuck, and (second) after how long it is only stale.",
    voice: { verb: "stuck", phrases: ["anything stuck over ten minutes", "what's been stuck for an hour"],
      choice: "Show what is stuck: asks or messages still open past a time (\"anything stuck over ten minutes?\")." } },
  { id: "tally", group: "Errors", names: ["tally"], tail: "(\\s+(foot|inline))?", syntax: ":tally foot · inline", args: ["foot", "inline"],
    desc: "Where the FAILED · STUCK tally sits: the foot of the world, or inline in the status row." },

  /* ---------------- Act (point & speak: opcenter.ts) ---------------- */
  { id: "point", group: "Act", names: ["point"], tail: "(\\s+\\S.*)?", syntax: ":point [open|close|<lane>]", args: ["open", "close"], literal: false,
    keys: [{ k: ["/"] }], desc: "Open the action strip on what the pointer rests on (a click does the same); close it; or point at a lane's latest session by name.",
    voice: { phrases: [["act on this", "point open"]] } },
  { id: "report", group: "Act", names: ["report"], tail: "(\\s+\\S.*)?", syntax: ":report [words]", literal: false, keys: [{ k: ["r"], scope: "ps" }],
    desc: "Through Scout (traced): Scoutbot reports on the pointed session. Goes to review first.",
    voice: { phrases: [["report on this", "report"], ["give me a report on this", "report"]] } },
  { id: "dispatch", group: "Act", names: ["dispatch"], tail: "(\\s+\\S.*)?", syntax: ":dispatch [words]", literal: false, keys: [{ k: ["d"], scope: "ps" }],
    desc: "Through Scout (traced): start a new session on the pointed machine, in its lane. Goes to review first.",
    voice: { phrases: [["dispatch here", "dispatch"], ["start a session here", "dispatch"]] } },
  { id: "send", group: "Act", names: ["send"], tail: "(\\s+\\S.*)?", syntax: ":send [words]", literal: false, keys: [{ k: ["s"], scope: "ps" }],
    desc: "Direct (untraced): type words into the pointed session's live process. Never falls back to Ask; goes to review first.",
    voice: { phrases: [["send it directly", "send"], ["type it into the session", "send"]] } },
  { id: "speak", group: "Act", names: ["speak"], tail: ON_OFF, syntax: ":speak [on|off]", args: ["on", "off"],
    keys: [{ k: ["Alt"], hold: true, label: "⌥ HOLD" }],
    desc: "Hold ⌥ with something pointed at: the words go to it (Ask unless they say otherwise); release to review. Frozen, it asks about the frame." },
  { id: "say", group: "Act", names: ["say"], tail: "\\s+\\S.*", syntax: ":say <words>", literal: false,
    desc: "Words for the selection as if spoken with ⌥ held (typed stand-in for voice); frozen, a question about the frame." },
  { id: "confirm", group: "Act", names: ["confirm"], tail: "", syntax: ":confirm", keys: [{ k: ["Enter"], scope: "ps" }],
    desc: "In review: send what it shows. A dry run unless :opcenter live and the server has that route." },
  { id: "edit", group: "Act", names: ["edit"], tail: "", syntax: ":edit", keys: [{ k: ["e"], scope: "ps" }],
    desc: "In review: edit the words before they go." },
  { id: "freeze", group: "Act", names: ["freeze"], tail: "(\\s+(on|off|jev(\\s+(on|off))?))?", syntax: ":freeze [on|off] · :freeze jev [on|off]", args: ["on", "off", "jev on", "jev off"],
    keys: [{ k: ["f"], scope: ["w", "frozen"] }],
    desc: "Freeze the frame: time holds, the world greys, and what is on it is grouped locally (dashed hulls). F again resumes. jev on: also send the groups (prompt text redacted) to the world-command route.",
    voice: { phrases: [["freeze the frame", "freeze on"], ["hold this frame", "freeze on"], ["unfreeze", "freeze off"]] } },
  { id: "opcenter", group: "Act", names: ["opcenter"], tail: "(\\s+(on|off|live|dry))?", syntax: ":opcenter on · off · live · dry", args: ["on", "off", "live", "dry"],
    desc: "Point & speak on or off; dry (the default) only logs each payload, live sends it where the server has the route (?live=1)." },

  /* ---------------- Inspect ---------------- */
  { id: "open", group: "Inspect", names: ["open", "i"], tail: "(\\s+(worktree|wt)\\s+\\S.*)?", syntax: ":open · :open worktree <name>", args: ["worktree "],
    keys: [{ k: ["i", "I"] }], essential: 7, desc: "Open the inspector on the slice under the playhead (pauses), or focus it when open.",
    voice: { verb: "open", phrases: ["inspect", "what's here", "open the inspector"], choice: "Open the inspector on what is under the playhead, or expand the file preview." } },
  { id: "zero", group: "Inspect", names: ["zero", "q"], tail: "", syntax: ":zero", keys: [{ k: ["q", "Q"] }], essential: 6,
    desc: "Zero in on the work behind the current ask: its files, its session, its linked asks.",
    voice: { verb: "zero-in", phrases: ["zero in", "drill in", "focus on the work"], choice: "Zero in on the work behind the current ask." } },
  { id: "linked", group: "Inspect", names: ["linked"], tail: "\\s+(next|prev)", syntax: ":linked next · prev", args: ["next", "prev"],
    keys: [{ k: ["]"], arg: "next", scope: "work" }, { k: ["["], arg: "prev", scope: "work" }], desc: "Zeroed in: step to the next or previous linked ask." },
  { id: "back", group: "Inspect", names: ["back"], tail: "", syntax: ":back", desc: "Back one step: close the preview, back up the inspector trail, or leave the panel.",
    voice: { verb: "back", phrases: ["go back", "never mind", "close that"], choice: "Go back: close the preview or inspector, or step out of the current focus." } },
  { id: "close", group: "Inspect", names: ["close"], tail: "", syntax: ":close", keys: [{ k: ["Escape"] }],
    desc: "Close the innermost thing: the file preview, the inspector, the stash, or the panel focus." },
  { id: "preview", group: "Inspect", names: ["preview"], tail: "", syntax: ":preview", keys: [{ k: ["p", "P"], scope: ["x", "s"] }],
    desc: "Expand the open file over the world, or shrink it back." },
  { id: "external", group: "Inspect", names: ["external"], tail: "", syntax: ":external", keys: [{ k: ["o", "O"], scope: ["x", "s"] }],
    desc: "Open the previewed file in its own app (a site opens in the browser)." },
  { id: "stash", group: "Inspect", names: ["stash"], tail: "(\\s+(add|show|hide))?", syntax: ":stash [add|show|hide]", args: ["add", "show", "hide"],
    keys: [{ k: ["s"], arg: "add" }, { k: ["S"] }], desc: "Stash the previewed file (add), or show and hide the stash board.",
    voice: { phrases: [["stash this file", "stash add"], ["show the stash", "stash show"], ["hide the stash", "stash hide"]] } },

  /* ---------------- Panels ---------------- */
  { id: "focus", group: "Panels", names: ["focus"], tail: "\\s+(w|a|b|d|e|f|g|h|j|k|l|t|p|r|x|next|prev|none)", syntax: ":focus <badge> · next · prev · none",
    args: ["w", "a", "b", "d", "e", "f", "g", "h", "j", "k", "l", "p", "r", "next", "prev", "none"],
    keys: [...["w", "a", "b", "d", "e", "f", "g", "h", "j", "k", "l", "t", "p", "r"].map(c => ({ k: [c], arg: c, label: "W A–K" })),
      { k: ["Tab"], arg: "next" }, { k: ["S-Tab"], arg: "prev" }],
    desc: "Focus a panel by its badge (lanes K · outcomes T/H · quota P · code R), the next or previous one, or none.",
    voice: { phrases: [["focus the world", "focus w"], ["focus the log", "focus j"], ["focus the roster", "focus b"], ["focus the code", "focus r"]] } },
  { id: "down", group: "Panels", names: ["down"], tail: "", syntax: ":down", keys: [{ k: ["j", "ArrowDown"], scope: ["x", "s", "v", "b", "h", "c", "j", "f", "preview"] }],
    desc: "Move down the focused list (inspector hits, stash cards, code, roster, outcomes, lanes, log, rhythm cells)." },
  { id: "up", group: "Panels", names: ["up"], tail: "", syntax: ":up", keys: [{ k: ["k", "ArrowUp"], scope: ["x", "s", "v", "b", "h", "c", "j", "f", "preview"] }],
    desc: "Move up the focused list." },
  { id: "right", group: "Panels", names: ["right"], tail: "", syntax: ":right", keys: [{ k: ["l", "ArrowRight"], scope: ["x", "s", "v", "j", "f"] }],
    desc: "Into the selection (unpack, open), the next stash card, or an hour later in the rhythm." },
  { id: "left", group: "Panels", names: ["left"], tail: "", syntax: ":left", keys: [{ k: ["h", "ArrowLeft"], scope: ["x", "s", "f", "preview"] }, { k: ["Backspace"], scope: ["x", "preview"] }],
    desc: "Back up the inspector trail, close the preview, the previous stash card, or an hour earlier in the rhythm." },
  { id: "enter", group: "Panels", names: ["enter"], tail: "", syntax: ":enter", keys: [{ k: ["Enter"], scope: ["w", "x", "s", "v", "b", "h", "c", "j", "f"] }],
    desc: "Act on the selection: unpack the hovered dot, fly to the agent or pin, solo the lane, seek the log line, jump to the cell." },
  { id: "remove", group: "Panels", names: ["remove"], tail: "", syntax: ":remove", keys: [{ k: ["Backspace", "Delete"], scope: ["s", "c"] }],
    desc: "Remove the selected stash card, or hide the selected lane." },
  { id: "asks", group: "Panels", names: ["asks"], tail: "\\s+(next|prev)", syntax: ":asks next · prev", args: ["next", "prev"],
    keys: [{ k: ["]"], arg: "next", scope: "b" }, { k: ["["], arg: "prev", scope: "b" }], desc: "The selected roster agent's next or previous ask." },

  /* ---------------- Tour ---------------- */
  { id: "tour", group: "Tour", names: ["tour"], tail: "(\\s+\\S.*)?", syntax: ":tour <name> · stop", args: ["the-week", "recap", "stop"],
    desc: "Play a tour: a timed list of these same lines (<name>.tour in the tours dir; recap is built in when there is no file)." },
  { id: "recap", group: "Tour", names: ["recap"], tail: "(\\s+(show|hide|play|[1-9]|10))?", syntax: ":recap [show|hide|play|<n>]", args: ["show", "hide", "play", "1", "2", "3"],
    desc: "The week's highlights and lowlights: a card of picks, fly to one, or play them as a tour.",
    voice: { phrases: [["recap the week", "recap show"], ["show the recap", "recap show"], ["highlights and lowlights", "recap show"], ["play the recap", "recap play"], ["hide the recap", "recap hide"]] } },

  /* ---------------- Help ---------------- */
  { id: "help", group: "Help", names: ["help", "keys"], tail: "(\\s+\\S.*)?", syntax: ":help [search]", keys: [{ k: ["?"] }],
    desc: "Every command, its key and its words, grouped and searchable.", voice: { phrases: [["show the keys", "help"], ["help", "help"], ["what can i say", "help"]] } },
  { id: "commands", group: "Help", names: ["commands"], tail: "", syntax: ":commands", keys: [{ k: [":"] }],
    desc: "The command palette: type to search, Tab completes, Enter runs." },
];

/* ---------------- lookups ---------------- */

export const BY_ID: Record<string, CommandSpec> = Object.fromEntries(COMMANDS.map(c => [c.id, c]));
const BY_NAME: Record<string, CommandSpec> = {};
for (const c of COMMANDS) for (const n of c.names) BY_NAME[n] = c;
export const commandFor = (verb: string): CommandSpec | undefined => BY_NAME[String(verb || "").toLowerCase()];

const scopesOf = (b: KeyBind): Scope[] => (Array.isArray(b.scope) ? b.scope : [b.scope || "global"]);

/** The whole ":" grammar from the registry: a line that matches is a command, anything else is words. */
export function commandLineRe(filter: (c: CommandSpec) => boolean = () => true): RegExp {
  const alts = COMMANDS.filter(filter).map(c => `(?:${c.names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})${c.tail ? `(?:${c.tail})` : ""}`);
  return new RegExp(`^(?:${alts.join("|")})$`, "i");
}
export const CMD_LINE = commandLineRe();

/** "verb rest" → the entry and its argument (lowercased), or null for words. */
export function parseLine(line: string): { cmd: CommandSpec; verb: string; arg: string; raw: string } | null {
  const raw = String(line || "").trim().replace(/^:/, "").trim();
  if (!raw) return null;
  const [verb, ...rest] = raw.split(/\s+/);
  const cmd = commandFor(verb!);
  if (!cmd) return null;
  return { cmd, verb: verb!.toLowerCase(), arg: rest.join(" ").toLowerCase(), raw };
}

/** The ":" line a key binding stands for. */
export const bindLine = (c: CommandSpec, b: KeyBind) => c.names[0] + (b.arg ? " " + b.arg : "");

/** The KeyboardEvent → the string bindings are written in ("n", "?", "S-ArrowLeft", " "). */
export function keySig(e: { key: string; shiftKey?: boolean }): string {
  return (e.shiftKey && e.key.length > 1 ? "S-" : "") + e.key;
}

export type KeyHit = { cmd: CommandSpec; bind: KeyBind; scope: Scope };
/** scope → key → binding; built once */
export const KEYMAP: Record<string, Record<string, KeyHit>> = {};
/** two bindings on one key in one scope (must stay empty; tested) */
export const KEY_CONFLICTS: string[] = [];
for (const cmd of COMMANDS) for (const bind of cmd.keys || []) for (const scope of scopesOf(bind)) for (const k of bind.k) {
  const m = (KEYMAP[scope] ||= {});
  if (m[k]) KEY_CONFLICTS.push(`${scope} ${JSON.stringify(k)}: ${m[k]!.cmd.id} and ${cmd.id}`);
  else m[k] = { cmd, bind, scope };
}

/** The first binding for this key along the active scopes (innermost first). */
export function keyLookup(sig: string, scopes: Scope[]): KeyHit | null {
  for (const s of scopes) { const hit = KEYMAP[s]?.[sig]; if (hit) return hit; }
  return null;
}

/* ---------------- labels ---------------- */

const GLYPH: Record<string, string> = {
  " ": "SPC", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Enter: "↵", Escape: "ESC", Backspace: "⌫", Delete: "DEL",
  Tab: "TAB", Home: "HOME", End: "END", "-": "−", Alt: "⌥",
};
/** one key as printed: letters upper case, a capital is ⇧ + the letter */
export function keyLabel(k: string): string {
  if (k.startsWith("S-")) return "⇧" + keyLabel(k.slice(2));
  if (GLYPH[k]) return GLYPH[k]!;
  if (/^[a-z]$/.test(k)) return k.toUpperCase();
  if (/^[A-Z]$/.test(k)) return "⇧" + k;
  return k;
}
/** the keys of one binding, collapsing a letter and its capital when both do the same */
export function bindLabel(b: KeyBind): string {
  if (b.label) return b.label;
  const ks = b.k.filter(k => !(/^[A-Z]$/.test(k) && b.k.includes(k.toLowerCase())));
  return ks.map(keyLabel).join(" ");
}

/** Every key for a command, by scope: [{ scope, keys: "J ↓", arg }] — what the sheet and the palette print. */
export function keysFor(c: CommandSpec): { scope: Scope; label: string; arg?: string }[] {
  const out: { scope: Scope; label: string; arg?: string }[] = [];
  const seen = new Set<string>();
  for (const b of c.keys || []) for (const scope of scopesOf(b)) {
    const label = bindLabel(b), key = scope + "|" + label;
    if (seen.has(key)) continue; seen.add(key);
    out.push({ scope, label, arg: b.arg });
  }
  return out;
}
/** a short key summary: globals first, a label shared by panels written once ("↓ (ACTIVITY, TIMELINE)"), at most n */
export function keySummary(c: CommandSpec, n = 3): string {
  const by = new Map<string, Scope[]>();
  for (const k of keysFor(c)) by.set(k.label, [...(by.get(k.label) || []), k.scope]);
  return [...by.entries()].sort((a, b) => (a[1].includes("global") ? 0 : 1) - (b[1].includes("global") ? 0 : 1))
    .map(([l, sc]) => sc.includes("global") ? l : `${l} (${sc.map(x => SCOPE_NAME[x]).join(", ")})`).slice(0, n).join(" · ");
}
/** The footer strip: essentials in GLOBAL, or what the focused panel (and an open preview) binds, one cell per command. */
export function stripFor(scopes: Scope[]): [string, string][] {
  if (!scopes.some(s => s !== "global")) {
    return COMMANDS.filter(c => c.essential).sort((a, b) => a.essential! - b.essential!).map(c => {
      const ks = keysFor(c).filter(k => k.scope === "global").map(k => k.label);
      const label = c.id === "window" ? "[ ] 1–6" : [...new Set(ks)].slice(0, 2).join(" ");
      return [label, STRIP_WORD[c.id] || c.id] as [string, string];
    });
  }
  const cells = new Map<string, { labels: string[]; word: string }>();
  for (const s of scopes) {
    if (s === "global") break;
    for (const c of COMMANDS) for (const b of c.keys || []) {
      if (!scopesOf(b).includes(s)) continue;
      const cell = cells.get(c.id) || { labels: [], word: STRIP_WORD[c.id] || c.id };
      const l = bindLabel(b); if (!cell.labels.includes(l)) cell.labels.push(l);
      cells.set(c.id, cell);
    }
  }
  return [...cells.values()].map(c => [c.labels.join(" "), c.word] as [string, string]).slice(0, 10);
}
const STRIP_WORD: Record<string, string> = {
  play: "play · pause", turn: "turn", zoom: "zoom", window: "window", trouble: "failed · stuck", zero: "zero in", open: "inspector", theme: "theme",
  close: "back", enter: "act", confirm: "send", edit: "edit", report: "report", dispatch: "dispatch", send: "send · direct", freeze: "freeze", down: "down", up: "up", left: "back", right: "into", remove: "remove", goto: "hour", slice: "slice", stack: "stack",
};

/* ---------------- palette ---------------- */

export type PaletteRow = { kind: "group" | "cmd" | "arg" | "recent" | "hint"; line: string; label: string; desc: string; keys: string; group?: Group; strong?: boolean };

/** Fuzzy score of a query against a word: prefix > substring > in-order letters from the first; 0 = no match. */
export function fuzzy(q: string, word: string): number {
  q = q.toLowerCase(); word = word.toLowerCase();
  if (!q) return 1;
  if (word === q) return 100;
  if (word.startsWith(q)) return 80 - word.length * 0.1;
  const i = word.indexOf(q); if (i >= 0) return 60 - i;
  if (word[0] !== q[0]) return 0;
  let j = 0; for (const ch of word) if (ch === q[j]) j++;
  return j === q.length ? 30 - word.length * 0.1 : 0;
}

/**
 * What the palette lists for what's typed. Nothing typed: recent lines, then the groups. A group picked: its
 * commands. A verb being typed: matching commands (names, aliases, then descriptions). A verb and a space:
 * its argument completions, filtered by what's typed after it.
 */
export function paletteRows(input: string, opts: { recent?: string[]; group?: Group | null } = {}): PaletteRow[] {
  const recent = (opts.recent || []).filter(Boolean);
  const text = input.replace(/^:/, "");
  const row = (c: CommandSpec, kind: PaletteRow["kind"] = "cmd", line = c.names[0]!, strong = false): PaletteRow =>
    ({ kind, line, label: kind === "cmd" ? c.syntax : ":" + line, desc: c.desc, keys: keySummary(c, 2), group: c.group, strong });
  if (!text.trim()) {
    if (opts.group) return COMMANDS.filter(c => c.group === opts.group).map(c => row(c));
    const rows: PaletteRow[] = recent.slice(0, 5).map(l => { const p = parseLine(l); return { kind: "recent" as const, line: l, label: ":" + l, desc: p ? p.cmd.desc : "", keys: p ? keySummary(p.cmd, 1) : "" }; });
    for (const g of GROUPS) {
      const cs = COMMANDS.filter(c => c.group === g);
      rows.push({ kind: "group", line: "", label: g.toUpperCase(), desc: cs.map(c => ":" + c.names[0]).join(" "), keys: String(cs.length), group: g });
    }
    return rows;
  }
  const sp = text.search(/\s/);
  if (sp > 0) {
    const verb = text.slice(0, sp), rest = text.slice(sp).replace(/^\s+/, "");
    const c = commandFor(verb);
    if (!c) return [];
    const hits = (c.args || []).map(a => ({ a, s: fuzzy(rest, a) })).filter(x => !rest || x.s > 0).sort((x, y) => y.s - x.s);
    const rows: PaletteRow[] = recent.filter(l => l.toLowerCase().startsWith(c.names[0] + " " + rest.toLowerCase()) && l.length > c.names[0]!.length + 1).slice(0, 3)
      .map(l => ({ kind: "recent" as const, line: l, label: ":" + l, desc: c.desc, keys: "" }));
    for (const { a } of hits) {
      const line = `${c.names[0]} ${a}`.trimEnd(); if (rows.some(r => r.line === line)) continue;
      // each argument row shows the key that runs exactly it; the description once, on the first
      const keys = (c.keys || []).filter(b => b.arg === a.trim()).map(b => b.k.map(keyLabel).join(" ") + (scopesOf(b)[0] !== "global" ? ` (${SCOPE_NAME[scopesOf(b)[0]!]})` : ""));
      rows.push({ ...row(c, "arg", a.endsWith(" ") ? `${c.names[0]} ${a}` : line, true), keys: [...new Set(keys)].join(" · "), desc: rows.some(r => r.kind === "arg") ? "" : c.desc });
    }
    if (!rows.length) rows.push({ kind: "hint", line: "", label: c.syntax, desc: c.desc, keys: keySummary(c, 2), group: c.group });
    return rows;
  }
  const q = text.toLowerCase();
  const scored: { c: CommandSpec; s: number; strong: boolean }[] = [];
  for (const c of COMMANDS) {
    const byName = Math.max(...c.names.map(n => fuzzy(q, n)));
    const byDesc = q.length >= 3 && c.desc.toLowerCase().includes(q) ? 20 : 0;
    const byGroup = q.length >= 3 && c.group.toLowerCase().startsWith(q) ? 15 : 0;
    const s = Math.max(byName, byDesc, byGroup);
    if (s > 0) scored.push({ c, s: s + (recent.some(l => l.split(/\s+/)[0] === c.names[0]) ? 5 : 0), strong: byName >= 30 });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, 12).map(({ c, strong }) => row(c, "cmd", c.names[0], strong));
}

/* ---------------- the sheet ---------------- */

export type SheetRow = { id: string; group: Group; keys: { label: string; scopes: Scope[] }[]; syntax: string; desc: string; voice: Voice["phrases"] };
/** The "?" sheet's rows, grouped in registry order, filtered by a search over keys, syntax, words and description. */
export function sheetRows(query = ""): { group: Group; rows: SheetRow[] }[] {
  const q = query.trim().toLowerCase();
  const out: { group: Group; rows: SheetRow[] }[] = [];
  for (const g of GROUPS) {
    const rows = COMMANDS.filter(c => c.group === g).map(c => ({ id: c.id, group: g, keys: mergedKeys(c), syntax: c.syntax, desc: c.desc, voice: c.voice?.phrases || [] }))
      .filter(r => !q || [r.id, r.syntax, r.desc, ...r.voice.flat(), ...r.keys.map(k => k.label + " " + k.scopes.map(x => SCOPE_NAME[x]).join(" "))].join(" ").toLowerCase().includes(q));
    if (rows.length) out.push({ group: g, rows });
  }
  return out;
}

/** one entry per key label, with every scope it works in (a label bound in many panels is printed once) */
export function mergedKeys(c: CommandSpec): { label: string; scopes: Scope[] }[] {
  const by = new Map<string, Scope[]>();
  for (const k of keysFor(c)) by.set(k.label, [...(by.get(k.label) || []), k.scope]);
  return [...by.entries()].map(([label, scopes]) => ({ label, scopes }));
}

/** Pointer gestures aren't commands; the sheet lists them so it stays the whole story. */
export const GESTURES: [string, string][] = [
  ["drag", "Orbit / tilt · double-click frames a spot"], ["two fingers", "Pan · pinch zooms to the pointer"], ["wheel", "One window rung per notch"],
  ["⇧ · ⌥ · right drag", "Pan · the ground stays under the pointer"], ["right-click", "Actions on a dot, arc, card or file"],
  ["click", "Point & speak: the action strip on the session under the pointer (↵ still inspects)"], ["left rail", "Drag up / down to turn"],
];
