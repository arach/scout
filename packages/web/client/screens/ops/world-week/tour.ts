/* tours: a timed list of ":" command lines the HUD plays back on its own clock — a demo, a walkthrough, a film take.
 *
 *   # the-week.tour            comments start with #
 *   name The Week              shown while it plays (default: the file's name)
 *   bpm 138                    optional: lets a line say b=<bar> instead of t=<seconds>
 *   beats 4                    optional: beats per bar (default 4)
 *   offset 0.12                optional: seconds before bar 0 (where the first downbeat sits)
 *   quiet                      optional: the lines' own status flashes stay quiet while it plays
 *   t=0     speed 1h/s         each line: when, then exactly what you'd type after ":"
 *   b=6     fly low day over 8s
 *   t=+2.5  open worktree x    t=+n is relative to the line before
 *
 * Pure parsing lives here (tested); the engine runs it. */

export type TourStep = { t: number; line: string; at: number };
export type Tour = { name: string; quiet: boolean; bpm: number | null; steps: TourStep[]; length: number };

export function parseTour(text: string, fallbackName = "tour"): Tour {
  let name = fallbackName, quiet = false, bpm: number | null = null, beats = 4, offset = 0, last = 0;
  const steps: TourStep[] = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const s = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!s) return;
    const dir = s.match(/^(name|bpm|beats|offset|quiet)\b\s*(.*)$/i);
    if (dir) {
      const k = dir[1].toLowerCase(), v = dir[2].trim();
      if (k === "name") name = v || name;
      else if (k === "quiet") quiet = v !== "off";
      else { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`line ${i + 1}: ${k} needs a number`); if (k === "bpm") bpm = n || null; else if (k === "beats") beats = n || 4; else offset = n; }
      return;
    }
    const m = s.match(/^(t|b)=(\+)?(-?\d+(?:\.\d+)?)\s+(.+)$/i);
    if (!m) throw new Error(`line ${i + 1}: expected t=<seconds> or b=<bar> then a command`);
    let t = Number(m[3]);
    if (m[1].toLowerCase() === "b") { if (!bpm) throw new Error(`line ${i + 1}: b= needs a bpm line first`); t = (m[2] ? 0 : offset) + t * beats * 60 / bpm; }
    if (m[2]) t += last;
    if (t < 0) throw new Error(`line ${i + 1}: time before the start`);
    last = t; steps.push({ t, line: m[4].trim(), at: i + 1 });
  });
  steps.sort((a, b) => a.t - b.t || a.at - b.at);
  return { name, quiet, bpm, steps, length: steps.length ? steps[steps.length - 1].t : 0 };
}

/* playback rates: how much of the week passes per second of yours — "1h/s", "10m/s", "30s/s", "realtime" (= 1s/s) */
const UNIT: Record<string, number> = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 };
export function parseRate(arg: string): number | null {
  const a = String(arg || "").trim().toLowerCase();
  if (a === "realtime" || a === "real" || a === "live") return 1;
  const m = a.match(/^(\d+(?:\.\d+)?)\s*([smhd])\s*\/\s*s$/);
  return m && Number(m[1]) > 0 ? Number(m[1]) * UNIT[m[2]] / 1e3 : null;
}
/** a week-seconds-per-second rate in the HUD's own words */
export function rateLabel(rate: number): string {
  if (Math.abs(rate - 1) < 1e-6) return "REAL TIME";
  const [u, k] = rate >= 864e2 ? ["D", 864e2] : rate >= 3600 ? ["H", 3600] : rate >= 60 ? ["M", 60] : ["S", 1];
  const v = rate / k;
  return `${+v.toFixed(v < 10 ? 2 : 1)}${u}/S`;
}

/* fly: "<what> [over Ns]" — what is any mix of
 *   a view (iso top side low) · a zoom rung (week 2d day 6h 2h) · az <deg> · el <deg> · turn <±deg> · r <units>
 *   x <units> z <units> · lane <name> (rides the lane as it re-ranks)
 *   (with playhead / follow, x is an offset from the playhead; with lane, z is an offset from the lane)
 *   playhead (the camera's centre goes to the playhead) · follow (and keeps following it) · work (the zero-in framing)
 *   home (the opening framing's centre: the middle of the week's work, the middle lane)
 *   cam <name> (a saved camera) · linear (no ease: a steady drift)
 * "over 0" (or "cut") lands at once. Duration defaults to 2s. */
export type FlySpec = {
  view?: string; level?: string; az?: number; el?: number; turn?: number; r?: number; x?: number; z?: number;
  lane?: string; playhead?: boolean; follow?: boolean; work?: boolean; home?: boolean; cam?: string; linear?: boolean; over: number;
};
const VIEW_WORDS = ["iso", "top", "side", "low"];
const LEVEL_WORDS: Record<string, string> = { week: "WEEK", "2d": "2 DAYS", "2days": "2 DAYS", day: "DAY", "6h": "6 H", "2h": "2 H" };
export function parseFly(arg: string): FlySpec | string {
  const w = String(arg || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: FlySpec = { over: 2 };
  const num = (i: number, what: string) => { const n = Number(w[i]); if (!Number.isFinite(n)) throw new Error(`${what} needs a number`); return n; };
  try {
    for (let i = 0; i < w.length; i++) {
      const k = w[i];
      if (VIEW_WORDS.includes(k)) out.view = k;
      else if (LEVEL_WORDS[k]) out.level = LEVEL_WORDS[k];
      else if (k === "az" || k === "el" || k === "turn" || k === "r" || k === "x" || k === "z") { (out as any)[k] = num(i + 1, k); i++; }
      else if (k === "lane") { if (!w[i + 1]) throw new Error("lane needs a name"); out.lane = w[++i]; }
      else if (k === "cam") { if (!w[i + 1]) throw new Error("cam needs a name"); out.cam = w[++i]; }
      else if (k === "playhead") out.playhead = true;
      else if (k === "follow") out.follow = true;
      else if (k === "work") out.work = true;
      else if (k === "home") out.home = true;
      else if (k === "linear") out.linear = true;
      else if (k === "cut") out.over = 0;
      else if (k === "over" || k === "in") { const m = (w[i + 1] || "").match(/^(\d+(?:\.\d+)?)s?$/); if (!m) throw new Error("over needs seconds, like 8s"); out.over = Number(m[1]); i++; }
      else return `FLY · don't know "${k}" · try fly low day over 8s`;
    }
  } catch (err) { return "FLY · " + (err as Error).message; }
  const { over, linear, ...what } = out;
  if (!Object.keys(what).length) return "FLY · where to? try fly top week over 6s";
  return out;
}

/* the window ladder: live · 5m · 30m · 4h · 24h · all — the window is the zoom.
 * fold is where the world sits on its way from detail to the machines: 0 the World (sessions, each call, asks between
 * named agents) · 0.5 sessions folded into their workspace lanes · 1 the Mesh (lanes grouped into machine bands).
 * level is the camera rung (the engine's LEVELS) that frames it. */
export type Rung = { k: string; label: string; ms: number | null; fold: number; level: string };
export const RUNGS: Rung[] = [
  { k: "live", label: "LIVE", ms: 60e3, fold: 0, level: "2 H" },
  { k: "5m", label: "5M", ms: 5 * 60e3, fold: 0, level: "2 H" },
  { k: "30m", label: "30M", ms: 30 * 60e3, fold: 0, level: "2 H" },
  { k: "4h", label: "4H", ms: 4 * 36e5, fold: 0.5, level: "6 H" },
  { k: "24h", label: "24H", ms: 864e5, fold: 1, level: "DAY" },
  { k: "all", label: "ALL", ms: null, fold: 1, level: "WEEK" },
];
/** ":window <arg>" → a rung index, "off", or null for words it doesn't know. cur is the rung now (-1 = no window). */
export function parseRung(arg: string, cur = -1): number | "off" | null {
  const a = String(arg || "").trim().toLowerCase();
  const i = RUNGS.findIndex(r => r.k === a);
  if (i >= 0) return i;
  if (/^[1-6]$/.test(a)) return Number(a) - 1;
  if (a === "off" || a === "none") return "off";
  if (a === "wider" || a === "out" || a === "]") return cur < 0 ? RUNGS.length - 1 : Math.min(RUNGS.length - 1, cur + 1);
  if (a === "narrower" || a === "in" || a === "[") return cur < 0 ? 0 : Math.max(0, cur - 1);
  return null;
}
/** The window a rung covers, ending at its anchor; a rung longer than the data shows all of it and says so (clamped). */
export function windowSpan(rung: number, anchor: number, from: number): { a: number; b: number; clamped: boolean } {
  const ms = RUNGS[rung].ms;
  if (ms == null) return { a: from, b: anchor, clamped: false };
  return { a: Math.max(from, anchor - ms), b: anchor, clamped: anchor - ms < from };
}
export function foldLevel(fold: number): "WORLD" | "LANES" | "MESH" { return fold < 0.35 ? "WORLD" : fold < 0.72 ? "LANES" : "MESH"; }
export const FOLD_BLURB: Record<string, string> = {
  WORLD: "SESSIONS · EACH CALL · ASKS BETWEEN NAMED AGENTS",
  LANES: "SESSIONS FOLDED INTO WORKSPACES · CALLS AS DENSITY",
  MESH: "MACHINES · LANES AS VOLUME · ASKS AS TRAFFIC",
};
/** a span in the HUD's words: 60S · 5M · 4H · 1D 6H */
export function spanLabel(ms: number): string {
  if (ms < 6e4) return Math.max(0, Math.round(ms / 1e3)) + "S";
  if (ms < 36e5) return Math.round(ms / 6e4) + "M";
  if (ms < 864e5) { const h = ms / 36e5; return (h < 10 && h % 1 ? h.toFixed(1) : Math.round(h)) + "H"; }
  const d = Math.floor(ms / 864e5), h = Math.round((ms - d * 864e5) / 36e5);
  return h ? `${d}D ${h}H` : `${d}D`;
}
