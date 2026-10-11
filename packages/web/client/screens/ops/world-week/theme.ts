/*
 * World · Week theme tokens. Every colour the study paints — CSS, canvas,
 * and the point-cloud shader — comes from this file. Treatments:
 *   paper  Paper · Amber   warm off-white sheet, one amber accent (lead)
 *   linen  Linen · Ochre   deeper sand, lighter panels, burnt-orange accent
 *   ember  Ember           brown-black, the dark sibling of Paper
 *   dusk   Dusk · Brass    mid warm ground so density still reads
 *   scout  Scout           the current dark / emerald HUD, unchanged
 * Dusk is the extra treatment: a value between linen and ember, so the
 * cloud is not only tested on pure paper and pure dark.
 *
 * world-modale copy: adds `alarm` (FAILED · STUCK, one colour per treatment, never the accent), defaults to
 * scout, and keeps its own storage keys (world-modale.theme / world-modale.accent).
 *
 * Accent is a second axis (?accent=, the status control, the ' key).
 * It does not repaint a treatment. Paper, linen, ember, and dusk default
 * to amber; scout defaults to emerald. Until the axis is set, each
 * treatment keeps the accent it was tuned with.
 */

export const THEME_IDS = ["paper", "linen", "ember", "dusk", "scout"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** Graphite has no hue: the accent is the treatment's ink. */
export const ACCENT_IDS = ["amber", "emerald", "cobalt", "vermilion", "violet", "graphite"] as const;
export type AccentId = (typeof ACCENT_IDS)[number];

export type ShikiTheme = {
  name: string;
  type: "dark" | "light";
  colors: { "editor.background": string; "editor.foreground": string };
  tokenColors: { scope: string[]; settings: { foreground?: string; fontStyle?: string } }[];
};

export type Theme = {
  id: ThemeId;
  label: string;
  title: string;
  /** Light page ground. Form controls and grain follow this, not the point shader. */
  light: boolean;
  /** Points/arcs paint as `point` ink with retuned alpha. Off = the legacy white-gray cloud. */
  inkPoints: boolean;
  /** Material blend. Light grounds stay normal: additive light vanishes on paper. */
  blend: "normal" | "additive";
  scheme: "light" | "dark";
  /** Layout skin. Only Scout keeps data-skin="scout" (hairline chrome). */
  skin: string;
  hair: number;
  grain: number;
  grainBlend: "screen" | "multiply";
  ground: string;
  groundLift: string;
  sheen: string;
  veil: string;
  panel: string;
  panelHi: string;
  panelLine: string;
  ink: string;
  dim: string;
  faint: string;
  line: string;
  accent: string;
  accentDim: string;
  accentSoft: string;
  accentFocus: string;
  ok: string;
  warn: string;
  fail: string;
  /** FAILED · STUCK: one alarm colour, distinct from the accent; no traffic lights. */
  alarm: string;
  sheet: string;
  float: string;
  card: string;
  chip: string;
  scrim: string;
  shadow: string;
  sel: string;
  hover: string;
  board: string;
  stage: string;
  shade: string;
  /** Canvas ink. Scout keeps the pre-skin green-gray, which is not the DOM ink. */
  cInk: string;
  cDim: string;
  cFaint: string;
  cLine: string;
  cAccent: string;
  point: string;
  arc: string;
  rail: string;
  hot: string;
  peak: string;
  pin: string;
  pinSub: string;
  tag: string;
  tick: string;
  dot: string;
  meshDot: string;
  meshEdge: string;
  meshEdgeDim: string;
  meshNode: string;
  codeFg: string;
  codeGutter: string;
  codeSel: string;
  codeInk: string;
  codeBg: string;
  codeSurface: string;
  codeBorder: string;
  codeMuted: string;
  synComment: string;
  synKeyword: string;
  synString: string;
  synNumber: string;
  synType: string;
  synFunction: string;
  synProperty: string;
  synPunct: string;
  synHeading: string;
  synInvalid: string;
  /** Shader multipliers, or absolute 0–1 colours when inkPoints is on. */
  tints: readonly (readonly [number, number, number])[];
  /** CSS lane labels: displayed rgb = tint * tintMul. */
  tintMul: readonly [number, number, number];
  shiki: ShikiTheme;
};

const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const tintsOf = (...hexes: string[]) => hexes.map(hexRgb) as Theme["tints"];

function syntaxTheme(id: string, light: boolean, fg: string, syn: Pick<Theme, "synComment" | "synKeyword" | "synString" | "synNumber" | "synType" | "synFunction" | "synProperty" | "synPunct" | "synHeading" | "synInvalid">): ShikiTheme {
  const fgOf = (foreground: string, fontStyle?: string) => ({ foreground, ...(fontStyle ? { fontStyle } : {}) });
  return {
    name: `wm-${id}`,
    type: light ? "light" : "dark",
    colors: { "editor.background": "#00000000", "editor.foreground": fg },
    tokenColors: [
      { scope: ["comment", "punctuation.definition.comment"], settings: fgOf(syn.synComment, "italic") },
      { scope: ["keyword", "keyword.control", "storage.type", "storage.modifier", "keyword.operator.new"], settings: fgOf(syn.synKeyword) },
      { scope: ["storage.modifier.attribute", "meta.attribute", "entity.other.attribute-name", "support.variable.attribute", "punctuation.definition.annotation", "meta.annotation"], settings: fgOf(syn.synFunction) },
      { scope: ["string", "punctuation.definition.string", "constant.other.symbol", "markup.inline.raw"], settings: fgOf(syn.synString) },
      { scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant", "keyword.other.unit"], settings: fgOf(syn.synNumber) },
      { scope: ["entity.name.type", "entity.other.inherited-class", "support.type", "support.class", "entity.name.namespace", "meta.type-name"], settings: fgOf(syn.synType) },
      { scope: ["entity.name.function", "support.function", "meta.function-call", "variable.function"], settings: fgOf(syn.synFunction) },
      { scope: ["variable.other.property", "support.type.property-name", "variable.other.object.property", "meta.attribute-selector"], settings: fgOf(syn.synProperty) },
      { scope: ["entity.name.tag"], settings: fgOf(syn.synKeyword) },
      { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: fgOf(syn.synPunct) },
      { scope: ["markup.heading", "entity.name.section"], settings: fgOf(syn.synHeading, "bold") },
      { scope: ["markup.underline.link", "string.other.link", "constant.other.reference.link"], settings: fgOf(syn.synKeyword) },
      { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
      { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
      { scope: ["variable.language", "keyword.other.special-method"], settings: fgOf(syn.synNumber) },
      { scope: ["invalid", "invalid.illegal"], settings: fgOf(syn.synInvalid) },
    ],
  };
}

const SCOUT_TINTS: Theme["tints"] = [
  [0.62, 1, 0.84], [1, 0.86, 0.6], [0.66, 0.8, 1], [1, 0.7, 0.76],
  [0.84, 0.72, 1], [0.6, 0.96, 1], [1, 0.95, 0.62], [0.82, 0.84, 0.86],
];

const scoutShiki: ShikiTheme = {
  name: "wm-scout",
  type: "dark",
  colors: { "editor.background": "#00000000", "editor.foreground": "#ccd3dd" },
  tokenColors: [
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#707a8c", fontStyle: "italic" } },
    { scope: ["keyword", "keyword.control", "storage.type", "storage.modifier", "keyword.operator.new"], settings: { foreground: "#c792ea" } },
    { scope: ["storage.modifier.attribute", "meta.attribute", "entity.other.attribute-name", "support.variable.attribute", "punctuation.definition.annotation", "meta.annotation"], settings: { foreground: "#e8a662" } },
    { scope: ["string", "punctuation.definition.string", "constant.other.symbol", "markup.inline.raw"], settings: { foreground: "#9ece6a" } },
    { scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant", "keyword.other.unit"], settings: { foreground: "#e0af68" } },
    { scope: ["entity.name.type", "entity.other.inherited-class", "support.type", "support.class", "entity.name.namespace", "meta.type-name"], settings: { foreground: "#63cdd6" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call", "variable.function"], settings: { foreground: "#82aaff" } },
    { scope: ["variable.other.property", "support.type.property-name", "variable.other.object.property", "meta.attribute-selector"], settings: { foreground: "#a8c1e8" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#c792ea" } },
    { scope: ["punctuation", "meta.brace", "keyword.operator"], settings: { foreground: "#8a94a6" } },
    { scope: ["markup.heading", "entity.name.section"], settings: { foreground: "#eaeef5", fontStyle: "bold" } },
    { scope: ["markup.underline.link", "string.other.link", "constant.other.reference.link"], settings: { foreground: "#82aaff" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["variable.language", "keyword.other.special-method"], settings: { foreground: "#e0af68" } },
    { scope: ["invalid", "invalid.illegal"], settings: { foreground: "#e88a8a" } },
  ],
};

type Paint = Omit<Theme, "shiki"> & { shiki?: ShikiTheme };

function theme(p: Paint): Theme {
  const syn = p;
  return { ...p, shiki: p.shiki ?? syntaxTheme(p.id, p.light, p.codeFg, syn) };
}

const paperSyn = {
  synComment: "#6A6158",
  synKeyword: "#9A5410",
  synString: "#6E3A28",
  synNumber: "#2A241C",
  synType: "#5C5348",
  synFunction: "#7A420A",
  synProperty: "#5C5348",
  synPunct: "#6A6158",
  synHeading: "#2A241C",
  synInvalid: "#6E3A28",
};

const linenSyn = {
  synComment: "#5C4E42",
  synKeyword: "#7A3B0C",
  synString: "#6B3418",
  synNumber: "#241C14",
  synType: "#4E4238",
  synFunction: "#7A3B0C",
  synProperty: "#4E4238",
  synPunct: "#5C4E42",
  synHeading: "#241C14",
  synInvalid: "#6B3418",
};

const emberSyn = {
  synComment: "#A3988C",
  synKeyword: "#E0A04A",
  synString: "#C4A07A",
  synNumber: "#F3EBDF",
  synType: "#D9CBB8",
  synFunction: "#E0A04A",
  synProperty: "#C4B6A4",
  synPunct: "#A3988C",
  synHeading: "#F3EBDF",
  synInvalid: "#C4A07A",
};

const duskSyn = {
  synComment: "#D9CBB8",
  synKeyword: "#E2A15A",
  synString: "#F0D0A8",
  synNumber: "#F6F0E6",
  synType: "#E7DCCB",
  synFunction: "#E2A15A",
  synProperty: "#E7DCCB",
  synPunct: "#D9CBB8",
  synHeading: "#F6F0E6",
  synInvalid: "#F0D0A8",
};

export const THEMES: Record<ThemeId, Theme> = {
  paper: theme({
    id: "paper",
    label: "PAPER",
    title: "Paper · Amber",
    light: true,
    inkPoints: true,
    blend: "normal",
    scheme: "light",
    skin: "",
    hair: 1,
    grain: 0.05,
    grainBlend: "multiply",
    ground: "#F5F1E8",
    groundLift: "#FBF8F3",
    sheen: "rgba(255,252,247,0)",
    veil: "rgba(42,36,28,0.035)",
    panel: "#FBF8F3",
    panelHi: "#FBF8F3",
    panelLine: "rgba(42,36,28,0.22)",
    ink: "#2A241C",
    dim: "#5C5348",
    faint: "#6A6158",
    line: "rgba(42,36,28,0.16)",
    accent: "#9A5410",
    accentDim: "rgba(154,84,16,0.45)",
    accentSoft: "rgba(154,84,16,0.08)",
    accentFocus: "rgba(154,84,16,0.55)",
    ok: "#2A241C",
    warn: "#9A5410",
    fail: "#6E3A28",
    alarm: "#A8361C",
    sheet: "rgba(251,248,243,0.97)",
    float: "rgba(251,248,243,0.92)",
    card: "#F7F1E6",
    chip: "rgba(251,248,243,0.8)",
    scrim: "rgba(42,36,28,0.46)",
    shadow: "rgba(42,36,28,0.16)",
    sel: "rgba(42,36,28,0.06)",
    hover: "rgba(42,36,28,0.045)",
    board: "rgba(42,36,28,0.1)",
    stage: "#FFFFFF",
    shade: "#2A241C",
    cInk: "#2A241C",
    cDim: "#5C5348",
    cFaint: "#6A6158",
    cLine: "rgba(42,36,28,0.28)",
    cAccent: "#9A5410",
    point: "#2A241C",
    arc: "#2A241C",
    rail: "rgba(42,36,28,0.35)",
    hot: "#9A5410",
    peak: "rgba(42,36,28,0.55)",
    pin: "rgba(42,36,28,0.5)",
    pinSub: "rgba(154,84,16,0.85)",
    tag: "rgba(251,248,243,0.96)",
    tick: "rgba(42,36,28,0.28)",
    dot: "rgba(42,36,28,0.16)",
    meshDot: "rgba(42,36,28,0.18)",
    meshEdge: "rgba(42,36,28,0.45)",
    meshEdgeDim: "rgba(42,36,28,0.16)",
    meshNode: "rgba(42,36,28,0.4)",
    codeFg: "#2A241C",
    codeGutter: "#6A6158",
    codeSel: "rgba(154,84,16,0.18)",
    codeInk: "#2A241C",
    codeBg: "#F5F1E8",
    codeSurface: "rgba(42,36,28,0.04)",
    codeBorder: "rgba(42,36,28,0.14)",
    codeMuted: "#6A6158",
    ...paperSyn,
    tints: tintsOf("#2A241C", "#4A3B28", "#6A4A28", "#9A5410", "#5C4632", "#3E3428", "#7A5530", "#3A2A1C"),
    tintMul: [255, 255, 255],
  }),
  linen: theme({
    id: "linen",
    label: "LINEN",
    title: "Linen · Ochre",
    light: true,
    inkPoints: true,
    blend: "normal",
    scheme: "light",
    skin: "",
    hair: 1,
    grain: 0.055,
    grainBlend: "multiply",
    ground: "#D9C4A8",
    groundLift: "#EAD9C2",
    sheen: "rgba(255,248,236,0)",
    veil: "rgba(36,28,20,0.04)",
    panel: "#F6EBDD",
    panelHi: "#FBF6EE",
    panelLine: "rgba(36,28,20,0.28)",
    ink: "#241C14",
    dim: "#4E4238",
    faint: "#5C4E42",
    line: "rgba(36,28,20,0.18)",
    accent: "#7A3B0C",
    accentDim: "rgba(122,59,12,0.45)",
    accentSoft: "rgba(122,59,12,0.1)",
    accentFocus: "rgba(122,59,12,0.55)",
    ok: "#241C14",
    warn: "#7A3B0C",
    fail: "#6B3418",
    alarm: "#8A2A10",
    sheet: "rgba(246,235,221,0.97)",
    float: "rgba(246,235,221,0.94)",
    card: "#FBF6EE",
    chip: "rgba(246,235,221,0.84)",
    scrim: "rgba(36,28,20,0.48)",
    shadow: "rgba(36,28,20,0.18)",
    sel: "rgba(36,28,20,0.07)",
    hover: "rgba(36,28,20,0.05)",
    board: "rgba(36,28,20,0.12)",
    stage: "#FFFFFF",
    shade: "#241C14",
    cInk: "#241C14",
    cDim: "#4E4238",
    cFaint: "#5C4E42",
    cLine: "rgba(36,28,20,0.32)",
    cAccent: "#7A3B0C",
    point: "#241C14",
    arc: "#241C14",
    rail: "rgba(36,28,20,0.4)",
    hot: "#7A3B0C",
    peak: "rgba(36,28,20,0.55)",
    pin: "rgba(36,28,20,0.5)",
    pinSub: "rgba(122,59,12,0.85)",
    tag: "rgba(251,246,238,0.96)",
    tick: "rgba(36,28,20,0.3)",
    dot: "rgba(36,28,20,0.18)",
    meshDot: "rgba(36,28,20,0.2)",
    meshEdge: "rgba(36,28,20,0.48)",
    meshEdgeDim: "rgba(36,28,20,0.18)",
    meshNode: "rgba(36,28,20,0.42)",
    codeFg: "#241C14",
    codeGutter: "#5C4E42",
    codeSel: "rgba(122,59,12,0.18)",
    codeInk: "#241C14",
    codeBg: "#F6EBDD",
    codeSurface: "rgba(36,28,20,0.05)",
    codeBorder: "rgba(36,28,20,0.16)",
    codeMuted: "#5C4E42",
    ...linenSyn,
    tints: tintsOf("#241C14", "#4A3424", "#6A4020", "#7A3B0C", "#5A4030", "#3A2C22", "#6E4A30", "#3A2418"),
    tintMul: [255, 255, 255],
  }),
  ember: theme({
    id: "ember",
    label: "EMBER",
    title: "Ember",
    light: false,
    inkPoints: false,
    blend: "normal",
    scheme: "dark",
    skin: "",
    hair: 1,
    grain: 0.02,
    grainBlend: "screen",
    ground: "#14110E",
    groundLift: "#2A211A",
    sheen: "rgba(255,214,170,0.05)",
    veil: "rgba(243,235,223,0.028)",
    panel: "#221C17",
    panelHi: "#2A221C",
    panelLine: "rgba(243,235,223,0.2)",
    ink: "#F3EBDF",
    dim: "rgba(243,235,223,0.72)",
    faint: "rgba(243,235,223,0.55)",
    line: "rgba(243,235,223,0.14)",
    accent: "#E0A04A",
    accentDim: "rgba(224,160,74,0.4)",
    accentSoft: "rgba(224,160,74,0.1)",
    accentFocus: "rgba(224,160,74,0.55)",
    ok: "#F3EBDF",
    warn: "#E0A04A",
    fail: "#C4A07A",
    alarm: "#FF8A66",
    sheet: "rgba(28,24,20,0.97)",
    float: "rgba(20,17,14,0.9)",
    card: "#2A221C",
    chip: "rgba(20,17,14,0.72)",
    scrim: "rgba(12,10,8,0.72)",
    shadow: "rgba(0,0,0,0.45)",
    sel: "rgba(243,235,223,0.08)",
    hover: "rgba(243,235,223,0.06)",
    board: "rgba(243,235,223,0.08)",
    stage: "#FFFFFF",
    shade: "#000000",
    cInk: "#F3EBDF",
    cDim: "rgba(243,235,223,0.72)",
    cFaint: "rgba(243,235,223,0.55)",
    cLine: "rgba(243,235,223,0.16)",
    cAccent: "#E0A04A",
    point: "#F3EBDF",
    arc: "#F3EBDF",
    rail: "rgba(243,235,223,0.35)",
    hot: "#FFFFFF",
    peak: "rgba(243,235,223,0.55)",
    pin: "rgba(243,235,223,0.5)",
    pinSub: "rgba(224,160,74,0.85)",
    tag: "rgba(28,24,20,0.94)",
    tick: "rgba(243,235,223,0.32)",
    dot: "rgba(243,235,223,0.14)",
    meshDot: "rgba(243,235,223,0.16)",
    meshEdge: "rgba(243,235,223,0.45)",
    meshEdgeDim: "rgba(243,235,223,0.14)",
    meshNode: "rgba(243,235,223,0.4)",
    codeFg: "#F3EBDF",
    codeGutter: "rgba(243,235,223,0.4)",
    codeSel: "rgba(224,160,74,0.22)",
    codeInk: "#F3EBDF",
    codeBg: "#14110E",
    codeSurface: "rgba(243,235,223,0.04)",
    codeBorder: "rgba(243,235,223,0.14)",
    codeMuted: "rgba(243,235,223,0.55)",
    ...emberSyn,
    tints: [
      [1, 0.86, 0.62], [1, 0.92, 0.78], [0.95, 0.78, 0.5], [1, 0.8, 0.55],
      [0.9, 0.82, 0.7], [1, 0.95, 0.8], [0.86, 0.7, 0.48], [0.95, 0.88, 0.75],
    ],
    tintMul: [243, 235, 223],
  }),
  dusk: theme({
    id: "dusk",
    label: "DUSK",
    title: "Dusk · Brass",
    light: false,
    inkPoints: true,
    blend: "normal",
    scheme: "dark",
    skin: "",
    hair: 1,
    grain: 0.02,
    grainBlend: "screen",
    ground: "#3A3128",
    groundLift: "#4A3E34",
    sheen: "rgba(255,220,180,0.05)",
    veil: "rgba(246,240,230,0.03)",
    panel: "#463C32",
    panelHi: "#524838",
    panelLine: "rgba(246,240,230,0.2)",
    ink: "#F6F0E6",
    dim: "rgba(246,240,230,0.78)",
    faint: "rgba(246,240,230,0.62)",
    line: "rgba(246,240,230,0.16)",
    accent: "#E2A15A",
    accentDim: "rgba(226,161,90,0.45)",
    accentSoft: "rgba(226,161,90,0.12)",
    accentFocus: "rgba(226,161,90,0.6)",
    ok: "#F6F0E6",
    warn: "#E2A15A",
    fail: "#F0D0A8",
    alarm: "#FFAA8C",
    sheet: "rgba(58,49,40,0.97)",
    float: "rgba(54,46,38,0.92)",
    card: "#524838",
    chip: "rgba(54,46,38,0.78)",
    scrim: "rgba(28,22,16,0.62)",
    shadow: "rgba(20,14,8,0.4)",
    sel: "rgba(246,240,230,0.08)",
    hover: "rgba(246,240,230,0.06)",
    board: "rgba(246,240,230,0.1)",
    stage: "#FFFFFF",
    shade: "#1A140E",
    cInk: "#F6F0E6",
    cDim: "rgba(246,240,230,0.78)",
    cFaint: "rgba(246,240,230,0.62)",
    cLine: "rgba(246,240,230,0.22)",
    cAccent: "#E2A15A",
    point: "#F6F0E6",
    arc: "#F6F0E6",
    rail: "rgba(246,240,230,0.4)",
    hot: "#E2A15A",
    peak: "rgba(246,240,230,0.55)",
    pin: "rgba(246,240,230,0.5)",
    pinSub: "rgba(226,161,90,0.9)",
    tag: "rgba(62,52,42,0.96)",
    tick: "rgba(246,240,230,0.32)",
    dot: "rgba(246,240,230,0.16)",
    meshDot: "rgba(246,240,230,0.18)",
    meshEdge: "rgba(246,240,230,0.45)",
    meshEdgeDim: "rgba(246,240,230,0.16)",
    meshNode: "rgba(246,240,230,0.4)",
    codeFg: "#F6F0E6",
    codeGutter: "rgba(246,240,230,0.45)",
    codeSel: "rgba(226,161,90,0.28)",
    codeInk: "#F6F0E6",
    codeBg: "#3A3128",
    codeSurface: "rgba(246,240,230,0.05)",
    codeBorder: "rgba(246,240,230,0.16)",
    codeMuted: "rgba(246,240,230,0.62)",
    ...duskSyn,
    tints: tintsOf("#F6F0E6", "#E2A15A", "#F0D7B0", "#E8C99A", "#F3E2C4", "#EDE0CC", "#E7C4A2", "#F7F1E8"),
    tintMul: [255, 255, 255],
  }),
  scout: theme({
    id: "scout",
    label: "SCOUT",
    title: "Scout",
    light: false,
    inkPoints: false,
    blend: "normal",
    scheme: "dark",
    skin: "scout",
    hair: 1,
    grain: 0.012,
    grainBlend: "screen",
    ground: "#07080a",
    groundLift: "#07080a",
    sheen: "rgba(255,255,255,0.03)",
    veil: "rgba(255,255,255,0.022)",
    panel: "rgba(255,255,255,0.014)",
    panelHi: "rgba(255,255,255,0.014)",
    panelLine: "rgba(228,236,240,0.16)",
    ink: "#e6ebef",
    dim: "rgba(228,236,240,0.5)",
    faint: "rgba(228,236,240,0.26)",
    line: "rgba(228,236,240,0.1)",
    accent: "#3ee0a0",
    accentDim: "rgba(62,224,160,0.35)",
    accentSoft: "rgba(62,224,160,0.05)",
    accentFocus: "rgba(62,224,160,0.45)",
    ok: "#e6ebef",
    warn: "#3ee0a0",
    fail: "rgba(228,236,240,0.26)",
    alarm: "#ff8f66",
    sheet: "rgba(7,8,10,0.985)",
    float: "rgba(6,8,9,0.9)",
    card: "rgba(10,12,14,0.96)",
    chip: "rgba(4,6,5,0.6)",
    scrim: "rgba(3,4,5,0.78)",
    shadow: "rgba(0,0,0,0.55)",
    sel: "rgba(228,240,233,0.06)",
    hover: "rgba(255,255,255,0.045)",
    board: "rgba(228,236,240,0.07)",
    stage: "#FFFFFF",
    shade: "#000000",
    cInk: "#e4ebe7",
    cDim: "rgba(228,240,233,0.46)",
    cFaint: "rgba(228,240,233,0.22)",
    cLine: "rgba(228,240,233,0.12)",
    cAccent: "#3ee0a0",
    point: "#e4ebe7",
    arc: "#e4ebe7",
    rail: "rgba(228,240,233,0.22)",
    hot: "#ffffff",
    peak: "rgba(228,240,233,0.5)",
    pin: "rgba(228,240,233,0.55)",
    pinSub: "rgba(62,224,160,0.7)",
    tag: "rgba(4,6,5,0.9)",
    tick: "rgba(228,240,233,0.3)",
    dot: "rgba(228,240,233,0.12)",
    meshDot: "rgba(228,240,233,0.13)",
    meshEdge: "rgba(228,240,233,0.45)",
    meshEdgeDim: "rgba(228,240,233,0.1)",
    meshNode: "rgba(228,240,233,0.4)",
    codeFg: "#ccd3dd",
    codeGutter: "rgba(228,236,240,0.28)",
    codeSel: "rgba(62,224,160,0.2)",
    codeInk: "#e6ebef",
    codeBg: "#06070a",
    codeSurface: "rgba(255,255,255,0.03)",
    codeBorder: "rgba(228,236,240,0.14)",
    codeMuted: "rgba(228,236,240,0.55)",
    synComment: "#6f7a6e",
    synKeyword: "#7aa8ff",
    synString: "#c9a66b",
    synNumber: "#c98edb",
    synType: "#9fcf86",
    synFunction: "#d99a73",
    synProperty: "#8dc5c3",
    synPunct: "#7c8489",
    synHeading: "#eaeef5",
    synInvalid: "#e88a8a",
    tints: SCOUT_TINTS,
    tintMul: [228, 238, 233],
    shiki: scoutShiki,
  }),
};

/**
 * One light-ground hex and one dark-ground hex per hue. Tuned so 10px accent
 * text clears WCAG AA (4.5:1) on the hardest ground of that side: linen
 * #D9C4A8, and dusk #3A3128 (and each theme's panel). Graphite has no hue.
 */
export const ACCENTS: Record<AccentId, { label: string; title: string; light: string | null; dark: string | null }> = {
  amber: { label: "AMBER", title: "Amber", light: "#7A3B0C", dark: "#E0A04A" },
  emerald: { label: "EMERALD", title: "Emerald", light: "#105D3E", dark: "#3EE0A0" },
  cobalt: { label: "COBALT", title: "Cobalt", light: "#1A4F96", dark: "#8EB4F0" },
  vermilion: { label: "VERMILION", title: "Vermilion", light: "#8E3018", dark: "#EFA892" },
  violet: { label: "VIOLET", title: "Violet", light: "#6E2A9A", dark: "#C9A6EE" },
  graphite: { label: "GRAPHITE", title: "Graphite", light: null, dark: null },
};

export function defaultAccent(id: ThemeId): AccentId {
  return id === "scout" ? "emerald" : "amber";
}

export function isTheme(s: string): s is ThemeId {
  return (THEME_IDS as readonly string[]).includes(s);
}

export function isAccent(s: string): s is AccentId {
  return (ACCENT_IDS as readonly string[]).includes(s);
}

export function nextTheme(id: string): ThemeId {
  const i = THEME_IDS.indexOf(id as ThemeId);
  return THEME_IDS[(i < 0 ? 0 : i + 1) % THEME_IDS.length];
}

export function nextAccent(id: string): AccentId {
  const i = ACCENT_IDS.indexOf(id as AccentId);
  return ACCENT_IDS[(i < 0 ? 0 : i + 1) % ACCENT_IDS.length];
}

/**
 * First source that actually has the key: the live search, then the live href,
 * then the document's original navigation URL. The app router can drop `theme`
 * from the address before this module reads it; concatenating the two queries
 * would let a stale key override a live one.
 */
function studyParam(name: string): string | null {
  const read = (raw: string): string | null => {
    const q = raw.startsWith("?") ? raw.slice(1) : raw;
    const hash = q.indexOf("#");
    const params = new URLSearchParams(hash >= 0 ? q.slice(0, hash) : q);
    return params.has(name) ? params.get(name) : null;
  };
  try {
    if (typeof location !== "undefined" && location.search) {
      const v = read(location.search);
      if (v !== null || new URLSearchParams(location.search).has(name)) return v;
    }
  } catch { /* no location */ }
  try {
    if (typeof location !== "undefined") {
      const i = location.href.indexOf("?");
      if (i >= 0) {
        const v = read(location.href.slice(i));
        if (v !== null || new URLSearchParams(location.href.slice(i + 1)).has(name)) return v;
      }
    }
  } catch { /* no location */ }
  try {
    const nav = performance.getEntriesByType("navigation")[0] as { name?: string } | undefined;
    const nameUrl = nav?.name || "";
    const i = nameUrl.indexOf("?");
    if (i >= 0) return read(nameUrl.slice(i));
  } catch { /* no performance */ }
  return null;
}

/** ?theme= wins (including the original navigation URL), then this study's key, then Scout. */
export function resolveThemeId(): ThemeId {
  const q = studyParam("theme");
  if (q && isTheme(q.toLowerCase())) return q.toLowerCase() as ThemeId;
  try {
    const s = localStorage.getItem("world-modale.theme");
    if (s && isTheme(s)) return s;
  } catch { /* private mode */ }
  return "scout";
}

export type AccentChoice = { id: AccentId; explicit: boolean };

/** ?accent= or a stored pick is explicit. Otherwise the treatment keeps its own accent. */
export function resolveAccent(themeId: ThemeId): AccentChoice {
  const q = studyParam("accent");
  if (q && isAccent(q.toLowerCase())) return { id: q.toLowerCase() as AccentId, explicit: true };
  try {
    const s = localStorage.getItem("world-modale.accent");
    if (s && isAccent(s)) return { id: s, explicit: true };
  } catch { /* private mode */ }
  return { id: defaultAccent(themeId), explicit: false };
}

/** CSS accent and the canvas/shader accent. Graphite is the treatment's ink. */
export function accentHex(id: AccentId, t: Theme): { css: string; canvas: string } {
  if (id === "graphite") return { css: t.ink, canvas: t.cInk };
  const hex = (t.light ? ACCENTS[id].light : ACCENTS[id].dark) as string;
  return { css: hex, canvas: hex };
}

export type AccentPaint = {
  accent: string;
  accentDim: string;
  accentSoft: string;
  accentFocus: string;
  warn: string;
  codeSel: string;
  cAccent: string;
  pinSub: string;
  /** Null leaves the treatment's hot colour (ember and scout stay white). */
  hot: string | null;
};

/**
 * Unset axis: the treatment's own accent, untouched.
 * Set axis: the shared hue, light or dark for this ground. Amber on paper
 * then uses the table (#7A3B0C), not paper's baked #9A5410.
 */
export function accentPaint(t: Theme, choice: AccentChoice): AccentPaint {
  if (!choice.explicit) {
    return {
      accent: t.accent,
      accentDim: t.accentDim,
      accentSoft: t.accentSoft,
      accentFocus: t.accentFocus,
      warn: t.warn,
      codeSel: t.codeSel,
      cAccent: t.cAccent,
      pinSub: t.pinSub,
      hot: null,
    };
  }
  const { css, canvas } = accentHex(choice.id, t);
  const sameHot = t.hot.toLowerCase() === t.cAccent.toLowerCase();
  return {
    accent: css,
    accentDim: rgba(css, t.light ? 0.45 : 0.4),
    accentSoft: rgba(css, t.light ? 0.08 : 0.1),
    accentFocus: rgba(css, 0.55),
    warn: css,
    codeSel: rgba(css, t.light ? 0.18 : 0.22),
    cAccent: canvas,
    pinSub: rgba(canvas, 0.85),
    hot: sameHot ? canvas : null,
  };
}

export function accentVars(paint: AccentPaint): Record<string, string> {
  return {
    "--wm-accent": paint.accent,
    "--wm-accent-dim": paint.accentDim,
    "--wm-accent-soft": paint.accentSoft,
    "--wm-accent-focus": paint.accentFocus,
    "--wm-warn": paint.warn,
    "--wm-code-sel": paint.codeSel,
  };
}

export function themeVars(t: Theme): Record<string, string> {
  return {
    "--wm-ground": t.ground,
    "--wm-ground-lift": t.groundLift,
    "--wm-sheen": t.sheen,
    "--wm-veil": t.veil,
    "--wm-panel": t.panel,
    "--wm-panel-hi": t.panelHi,
    "--wm-panel-line": t.panelLine,
    "--wm-ink": t.ink,
    "--wm-dim": t.dim,
    "--wm-faint": t.faint,
    "--wm-line": t.line,
    "--wm-accent": t.accent,
    "--wm-accent-dim": t.accentDim,
    "--wm-accent-soft": t.accentSoft,
    "--wm-accent-focus": t.accentFocus,
    "--wm-ok": t.ok,
    "--wm-warn": t.warn,
    "--wm-fail": t.fail,
    "--wm-alarm": t.alarm,
    "--wm-alarm-dim": rgba(t.alarm, t.light ? 0.7 : 0.55),
    "--wm-alarm-faint": rgba(t.alarm, t.light ? 0.3 : 0.22),
    "--wm-sheet": t.sheet,
    "--wm-float": t.float,
    "--wm-card": t.card,
    "--wm-chip": t.chip,
    "--wm-scrim": t.scrim,
    "--wm-shadow": t.shadow,
    "--wm-sel": t.sel,
    "--wm-hover": t.hover,
    "--wm-board": t.board,
    "--wm-stage": t.stage,
    "--wm-shade": t.shade,
    "--wm-grain": String(t.grain),
    "--wm-grain-blend": t.grainBlend,
    "--wm-code-fg": t.codeFg,
    "--wm-code-gutter": t.codeGutter,
    "--wm-code-sel": t.codeSel,
    "--wm-code-ink": t.codeInk,
    "--wm-code-bg": t.codeBg,
    "--wm-code-surface": t.codeSurface,
    "--wm-code-border": t.codeBorder,
    "--wm-code-muted": t.codeMuted,
    "--wm-syn-comment": t.synComment,
    "--wm-syn-keyword": t.synKeyword,
    "--wm-syn-string": t.synString,
    "--wm-syn-number": t.synNumber,
    "--wm-syn-type": t.synType,
    "--wm-syn-function": t.synFunction,
    "--wm-syn-property": t.synProperty,
    "--wm-syn-punct": t.synPunct,
    "--wm-syn-heading": t.synHeading,
    "--wm-syn-invalid": t.synInvalid,
    "--bg": "var(--wm-ground)",
    "--fg": "var(--wm-ink)",
    "--dim": "var(--wm-dim)",
    "--faint": "var(--wm-faint)",
    "--line": "var(--wm-line)",
    "--accent": "var(--wm-accent)",
    "--accent-dim": "var(--wm-accent-dim)",
  };
}

export function themeBlock(t: Theme, choice?: AccentChoice | null): string {
  const vars = themeVars(t);
  if (choice) Object.assign(vars, accentVars(accentPaint(t, choice)));
  const body = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";");
  return `.wm-themes{color-scheme:${t.scheme};${body}}`;
}
