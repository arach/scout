/**
 * Home base: where the crew gathers when home, Scoutbot hosting. A slice of a
 * hex with rounded corners, flush to the bottom edge at the home corner. It
 * starts under the hex and stretches over the home-row figures next to it,
 * within a range. At home a figure either stands on top of it or rests
 * behind it, head over the lip.
 *
 * Study: design/studio/views/companion-specialists.tsx (Home base).
 */

/** Thickness of the slice, px. */
export const BASE_PLATE = 11;
/** The hex's 60° faces at either end. */
export const BASE_SHOULDER = BASE_PLATE / Math.tan(Math.PI / 3);
export const BASE_MIN = 72;
export const BASE_MAX = 300;
/** A figure this far past the crew already on the base is not part of it. */
export const BASE_GAP = 14;
/** Room between the outermost figure and the shoulder. */
const BASE_PAD = 4;

export type BaseSpan = { start: number; end: number };

/**
 * The base's extent along the band. `home` is the hex's span; `slots` are the
 * home-row figures (centre and width). The base grows outward from the home
 * corner over figures that stand shoulder to shoulder with it, until the next
 * one would leave a gap or push it past BASE_MAX.
 */
export function homeBaseSpan(options: {
  anchor: "left" | "right";
  home: BaseSpan;
  slots: readonly { x: number; w: number }[];
  width: number;
}): BaseSpan {
  const { anchor, home, width } = options;
  const out = BASE_SHOULDER + BASE_PAD;
  if (anchor === "left") {
    const start = Math.max(0, home.start - out);
    let reach = home.end;
    for (const slot of [...options.slots].sort((a, b) => a.x - b.x)) {
      const near = slot.x - slot.w / 2;
      const far = slot.x + slot.w / 2;
      if (far <= reach) continue;
      if (near - reach > BASE_GAP || far + out - start > BASE_MAX) break;
      reach = far;
    }
    return { start, end: Math.min(width, Math.max(start + BASE_MIN, reach + out)) };
  }
  const end = Math.min(width, home.end + out);
  let reach = home.start;
  for (const slot of [...options.slots].sort((a, b) => b.x - a.x)) {
    const near = slot.x + slot.w / 2;
    const far = slot.x - slot.w / 2;
    if (far >= reach) continue;
    if (reach - near > BASE_GAP || end - (far - out) > BASE_MAX) break;
    reach = far;
  }
  return { start: Math.max(0, Math.min(end - BASE_MIN, reach - out)), end };
}

/** True when a figure centred at `x` stands on the base (inside its shoulders). */
export function onBase(span: BaseSpan, x: number): boolean {
  return x > span.start + BASE_SHOULDER && x < span.end - BASE_SHOULDER;
}

type Pt = [number, number];

/** The plate's outline: a hex slice, shoulders rounded, feet softened on the edge. */
export function basePlatePath(width: number): string {
  const h = BASE_PLATE;
  const s = BASE_SHOULDER;
  const pts: Pt[] = [[0, h + 2], [s, 0], [width - s, 0], [width, h + 2]];
  const rs = [1.5, 4, 4, 1.5];
  const cut = (a: Pt, b: Pt, d: number): Pt => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
  };
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    const a = cut(cur, pts[(i - 1 + pts.length) % pts.length]!, rs[i]!);
    const b = cut(cur, pts[(i + 1) % pts.length]!, rs[i]!);
    d += `${i === 0 ? "M" : "L"}${a[0].toFixed(2)} ${a[1].toFixed(2)} Q${cur[0]} ${cur[1]} ${b[0].toFixed(2)} ${b[1].toFixed(2)} `;
  }
  return `${d}Z`;
}
