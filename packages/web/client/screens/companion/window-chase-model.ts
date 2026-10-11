/*
 * Companion · When the window moves: the motion model.
 *
 * Pure and framework-free. The Studio study
 * (design/studio/views/companion-window-chase.tsx) drives its own copy of this
 * file; keep the two in step. One Beat per placed figure. The page calls:
 *
 *   windowMoved(beat, now)        a poll saw the perch window translate
 *   windowVanished(beat, now)     the perch window left the screen (host: pending)
 *   windowGone(beat, now, landing, scurryTo?)
 *                                 the host decided it closed/minimized (`falling`):
 *                                 the Coyote fall onto `landing`, then maybe a
 *                                 scurry to a better spot
 *   putAway(beat, now, dest, after, delay)
 *                                 home, unpin, hide: scurry to `dest`, then
 *                                 rest there ("home") or vanish ("gone")
 *   returnToPerch(beat, now)      placed again: scurry back to the perch
 *   stepBeat(beat, now, dt, ctx)  every animation frame; returns a Pose
 *
 * Coordinates are page px, y down. `pos` is the figure's anchor (feet on a
 * top perch, the clinging side on a side perch); the renderer adds the box
 * offset. Times are ms.
 */

export type Pt = { x: number; y: number };
export type LongGap = "hover" | "nano" | "drop";
export type Variant = "hop" | "scurry" | "float" | "reduced";
export type Gaze =
  | "rest"
  | "look-down"
  | "look-up"
  | "look-left"
  | "look-right"
  | "look-down-left"
  | "look-down-right"
  | "look-up-left"
  | "look-up-right"
  | "blink-half";

export type Phase =
  | "attached" // riding the window, as today
  | "hang" //     the window left; dead still in the air
  | "worry" //    looks down, glances around, maybe drops a little
  | "spot" //     window settled: looks at it, perks up
  | "crouch" //   anticipation (squash, or a legs-spinning wind-up)
  | "travel" //   hurries over
  | "land" //     overshoot and settle onto the perch
  | "follow" //   a nudge: short ease, no beat
  | "fade" //     reduced motion: crossfade from old spot to new
  | "oblivious" //window vanished; still standing on nothing, unaware
  | "uhoh" //     looks down at the empty air, freezes, goes stiff
  | "camera" //   looks at the viewer, resigned (optional wave)
  | "drop" //     real gravity, stretched, looking up
  | "impact" //   big squash
  | "bounce" //   one small bounce
  | "dazed" //    wobble, half-shut eyes
  | "shake" //    shakes it off
  | "fadedown" // Reduced motion: out at the old spot, in where it landed
  | "down" //     fell; resting on whatever it fell onto
  | "home" //     put away: resting in its home slot
  | "gone"; //    put away off screen (unpinned, hidden, companion hidden)

/** Every number the beat uses. */
export const BEAT = {
  /** The host reads perched windows this often (ScoutCompanionController.perchInterval). */
  POLL_MS: 66,
  /** A translation smaller than this between two reads is not a move. */
  START_PX: 1.5,
  /** No translation for this long and the window has stopped (3–4 reads). */
  SETTLE_MS: 240,
  /** Off the cliff: dead still before it notices. */
  HANG_MS: 200,
  /** First look: straight down, with a gulp. */
  LOOK_DOWN_MS: 380,
  /** Each glance while the window keeps going. */
  GLANCE_MS: 360,
  /** Per-figure offset into the glance cycle, so a row never looks in unison. */
  GLANCE_OFFSET_MS: 140,
  /** Nervous hover: a slow bob plus a fine tremble. */
  HOVER_HZ: 3.2,
  HOVER_PX: 0.9,
  TREMBLE_HZ: 11,
  TREMBLE_PX: 0.35,
  /** A long gap: after this much stranded time, gravity notices too. */
  SAG_AFTER_MS: 1100,
  /** px/ms², about a third of a real fall at this scale: a cartoon drop. */
  GRAVITY: 0.0018,
  DROP_PX: 14,
  /** The picked long gap: a nano drop, a 3.5px sag caught with a small squash. */
  NANO_PX: 3.5,
  /** Float sinks instead of dropping. px/ms, cap px. */
  SINK_RATE: 0.006,
  SINK_PX: 8,
  /** Found it. */
  SPOT_MS: 180,
  SPOT_MS_FLOAT: 240,
  SPOT_MS_SCURRY: 110,
  /** Anticipation squash before the hop. */
  CROUCH_MS: 110,
  /** Scurry's wind-up: legs spinning in place, leaning back. */
  WINDUP_MS: 150,
  STRIDE_MS: 70,
  WINDUP_STRIDE_MS: 55,
  /** Several figures on one window: each sets off this much after the last. */
  STAGGER_MS: 90,
  /** Below this the window was nudged, not moved: a short ease, no beat. */
  NUDGE_PX: 24,
  FOLLOW_MS: 140,
  LAND_MS: 280,
  LAND_MS_SCURRY: 240,
  /** Reduced motion: out at the old spot, in at the new. */
  FADE_MS: 150,
  /** Float: a slightly underdamped spring (zeta about 0.62). */
  SPRING_K: 110,
  SPRING_C: 13,
} as const;

/** The window closes under it: the Wile E. Coyote fall. Replaces the shipped 520ms ease-in drop. */
export const COYOTE = {
  /** Counted from when the window left the screen (the host's pending read), not from `falling`. */
  OBLIVIOUS_MS: 340,
  UHOH_MS: 320,
  /** Look down this long before the freeze. */
  UHOH_LOOK_MS: 90,
  /** The freeze: a 2px pop up and an 8% stiffen. */
  UHOH_POP_MS: 60,
  CAMERA_MS: 360,
  /** px/ms². 300px takes about 480ms; 80px about 250ms. Slow at first by nature. */
  GRAVITY: 0.0026,
  /** Stretch while falling: 0.1 per px/ms of speed, capped. */
  STRETCH_PER_V: 0.1,
  STRETCH_MAX: 0.16,
  IMPACT_MS: 110,
  /** Landing squash: height to 62%, width to 130%. */
  SQUASH_Y: 0.38,
  SQUASH_X: 0.3,
  BOUNCE_MS: 220,
  /** Bounce height: 5% of the fall, 3–9px. */
  BOUNCE_PER_PX: 0.05,
  BOUNCE_MIN: 3,
  BOUNCE_MAX: 9,
  DAZED_MS: 360,
  DAZE_DEG: 7,
  DAZE_HZ: 2.6,
  SHAKE_MS: 160,
  SHAKE_DEG: 4,
  SHAKE_HZ: 10,
} as const;

/** Travel time by distance (px), per variant. */
export function travelMs(variant: Variant, dist: number): number {
  if (variant === "hop") return clamp(240 + 0.5 * dist, 320, 760);
  if (variant === "scurry") return clamp(160 + 0.38 * dist, 240, 560);
  return 0; // float is a spring: it ends when it is at rest
}

/** Hop apex above the higher of the two ends. */
export function hopHeight(dist: number): number {
  return clamp(0.16 * dist, 10, 40);
}

export type Beat = {
  phase: Phase;
  since: number;
  index: number;
  seed: number;
  pos: Pt;
  vel: Pt;
  hang: Pt;
  moveStart: number;
  sag: number;
  sagV: number;
  caughtAt: number | null;
  spotAt: number | null;
  from: Pt;
  dir: Pt;
  dist: number;
  dur: number;
  facing: 1 | -1;
  fallTo: Pt;
  /** Put away: a fixed destination that replaces the perch, and what happens there. */
  dest: Pt | null;
  after: "home" | "gone";
  /** The window has vanished: when, whether the figure already knew it was stranded, and whether the host has said gone. */
  vanishedAt: number | null;
  aware: boolean;
  dropReady: boolean;
  dropFrom: Pt;
  dropAt: number;
  /** A bad landing (the screen floor): scurry here after shaking it off. */
  scurryTo: Pt | null;
};

export type Ctx = {
  /** Where the perch is now, from the last window read. */
  target: Pt;
  /** The window translated within the last SETTLE_MS. */
  moving: boolean;
  variant: Variant;
  /** A long gap: hover in place, a nano drop (the pick), or a 14px drop. Float sinks instead. */
  gravity: LongGap;
  /** Lowest y the figure's anchor may reach (stays on screen). */
  floorY: number;
  /** The camera look before the drop: held, with a small wave (figures with a wave pose), or skipped. */
  cameraLook?: "hold" | "wave" | "off";
};

export type Pose = {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  gaze: Gaze;
  facing: 1 | -1;
  /** Run frame while scurrying, else null. */
  stride: 0 | 1 | null;
  opacity: number;
  /** The edge it was standing on, fading out under its feet. */
  ground: number;
  groundAt: Pt;
  /** 0.5px speed lines behind a dash. */
  trail: number;
  /** The wave pose (camera look), for figures that have one. */
  wave?: boolean;
};

export function createBeat(index: number, at: Pt, now = 0): Beat {
  return {
    phase: "attached",
    since: now,
    index,
    seed: (index * 7 + 3) % 4,
    pos: { ...at },
    vel: { x: 0, y: 0 },
    hang: { ...at },
    moveStart: now,
    sag: 0,
    sagV: 0,
    caughtAt: null,
    spotAt: null,
    from: { ...at },
    dir: { x: 1, y: 0 },
    dist: 0,
    dur: 0,
    facing: 1,
    fallTo: { ...at },
    dest: null,
    after: "home",
    vanishedAt: null,
    aware: false,
    dropReady: false,
    dropFrom: { ...at },
    dropAt: 0,
    scurryTo: null,
  };
}

/**
 * Put away (Send all home, Home, Unpin / Put away, Hide figure, Hide Desktop
 * Companion). Always the scurry, whatever the re-attach variant: look at
 * where it is going, legs spin, dash, skid. `after: "gone"` dashes through
 * `dest` (past the nearest screen edge) and vanishes. `delay` staggers a row.
 */
export function putAway(b: Beat, now: number, dest: Pt, after: "home" | "gone", delay = 0): void {
  if (b.phase === "gone") return;
  b.dest = { ...dest };
  b.after = after;
  b.hang = { ...b.pos };
  b.sag = 0;
  b.sagV = 0;
  b.caughtAt = null;
  b.spotAt = null;
  enter(b, "spot", now + delay);
}

/** Placed on a window again: scurry from wherever it is back to the perch. */
export function returnToPerch(b: Beat, now: number): void {
  b.dest = null;
  b.hang = { ...b.pos };
  b.sag = 0;
  b.sagV = 0;
  b.spotAt = null;
  b.vel = { x: 0, y: 0 };
  enter(b, "spot", now);
}

/** A read saw the perch window translate. Only a resting figure is left behind;
 *  one already hurrying back keeps chasing (it grabs on and rides). */
export function windowMoved(b: Beat, now: number): void {
  if (b.dest) return; // being put away: the window no longer matters
  if (b.phase !== "attached" && b.phase !== "follow" && b.phase !== "land" && b.phase !== "fade") return;
  b.phase = "hang";
  b.since = now;
  b.moveStart = now;
  b.hang = { ...b.pos };
  b.sag = 0;
  b.sagV = 0;
  b.caughtAt = null;
  b.spotAt = null;
}

const SETTLED_OR_AWAY: Phase[] = ["down", "home", "gone", "drop", "impact", "bounce", "dazed", "shake", "fadedown"];

/** The perch window left the screen (host: pending, cause unknown yet). The
 *  figure stands where it is; one that was riding along has no idea. */
export function windowVanished(b: Beat, now: number): void {
  if (b.dest || b.vanishedAt !== null || SETTLED_OR_AWAY.includes(b.phase)) return;
  b.vanishedAt = now;
  b.aware = b.phase !== "attached" && b.phase !== "follow" && b.phase !== "land" && b.phase !== "fade";
  b.dropReady = false;
  b.scurryTo = null;
  enter(b, "oblivious", now);
}

/** It came back (another Space, app unhidden) before the drop: nothing happened. */
export function windowReturned(b: Beat, now: number): void {
  if (b.vanishedAt === null || b.dropReady) return;
  b.vanishedAt = null;
  enter(b, "attached", now);
}

/** The host says the window is gone (its `falling` event): the drop may start
 *  once the figure has noticed. `landing` is fallTarget's anchor; `scurryTo`
 *  is set when that spot is a poor one (the bare screen floor). */
export function windowGone(b: Beat, now: number, landing: Pt, scurryTo: Pt | null = null): void {
  if (b.dest || SETTLED_OR_AWAY.includes(b.phase)) return;
  if (b.vanishedAt === null) windowVanished(b, now);
  b.dropReady = true;
  b.fallTo = { ...landing };
  b.scurryTo = scurryTo ? { ...scurryTo } : null;
}

export function stepBeat(b: Beat, now: number, dt: number, ctx: Ctx): Pose {
  // Putting away always scurries (or just fades under Reduce Motion), to a fixed spot.
  const c: Ctx = b.dest
    ? { ...ctx, target: b.dest, moving: false, gravity: "hover", variant: ctx.variant === "reduced" ? "reduced" : "scurry" }
    : ctx;
  const reduced = c.variant === "reduced";
  switch (b.phase) {
    case "attached":
      if (b.dest) {
        b.pos = { ...b.dest };
        enter(b, b.after === "gone" ? "gone" : "home", now);
        return stepBeat(b, now, dt, ctx);
      }
      b.pos = { ...c.target };
      b.facing = 1;
      return base(b);

    case "home":
      b.facing = 1;
      return base(b);

    case "gone":
      return { ...base(b), opacity: 0 };

    case "down":
      return base(b);

    case "oblivious":
    case "uhoh":
    case "camera":
    case "drop":
    case "impact":
    case "bounce":
    case "dazed":
    case "shake":
    case "fadedown":
      return coyoteStep(b, now, dt, c);

    case "hang":
    case "worry": {
      const stranded = now - b.moveStart;
      if (b.phase === "hang" && stranded >= BEAT.HANG_MS) b.phase = "worry";
      if (!reduced && c.gravity !== "hover") gravityStep(b, now, dt, c);
      b.pos = { x: b.hang.x, y: b.hang.y + b.sag };
      if (!c.moving) {
        if (b.spotAt === null) {
          const d = dist(b.pos, c.target);
          if (reduced) {
            b.from = { ...b.pos };
            enter(b, "fade", now);
            return stepBeat(b, now, dt, c);
          }
          if (d < BEAT.NUDGE_PX) {
            b.from = { ...b.pos };
            enter(b, "follow", now);
            return stepBeat(b, now, dt, c);
          }
          b.spotAt = now + b.index * BEAT.STAGGER_MS;
        }
        if (now >= b.spotAt) {
          enter(b, "spot", b.spotAt);
          return stepBeat(b, now, dt, c);
        }
      } else {
        b.spotAt = null;
      }
      return reduced ? strandedStill(b, now) : worryPose(b, now, c);
    }

    case "spot": {
      if (c.moving) return backToWorry(b, now, dt, c);
      if (reduced) {
        // Put away or placed again under Reduce Motion: a crossfade, after any stagger.
        if (now < b.since) return base(b);
        b.from = { ...b.pos };
        enter(b, "fade", now);
        return stepBeat(b, now, dt, ctx);
      }
      const dur = c.variant === "float" ? BEAT.SPOT_MS_FLOAT : c.variant === "scurry" ? BEAT.SPOT_MS_SCURRY : BEAT.SPOT_MS;
      const t = now - b.since;
      b.pos = { x: b.hang.x, y: b.hang.y + b.sag };
      const dx = c.target.x - b.pos.x;
      if (Math.abs(dx) > 1) b.facing = dx < 0 ? -1 : 1;
      if (t >= dur) {
        if (c.variant === "float") startTravel(b, now, c);
        else enter(b, "crouch", now);
        return stepBeat(b, now, dt, c);
      }
      const k = bump(t / dur);
      return { ...base(b), gaze: gazeToward(b.pos, c.target), y: b.pos.y - 1.5 * k, sx: 1 + 0.04 * k, sy: 1 + 0.04 * k, ground: 0 };
    }

    case "crouch": {
      if (c.moving) return backToWorry(b, now, dt, c);
      const scurry = c.variant === "scurry";
      const dur = scurry ? BEAT.WINDUP_MS : BEAT.CROUCH_MS;
      const t = now - b.since;
      b.pos = { x: b.hang.x, y: b.hang.y + b.sag };
      if (t >= dur) {
        startTravel(b, now, c);
        return stepBeat(b, now, dt, c);
      }
      const p = t / dur;
      const gaze = gazeToward(b.pos, c.target);
      if (scurry) {
        // Legs spinning in place, leaning back, a hair of jitter: then it goes.
        const stride = (Math.floor(t / BEAT.WINDUP_STRIDE_MS) % 2) as 0 | 1;
        return { ...base(b), gaze, stride, rot: -b.facing * 6 * easeOut(Math.min(1, p * 3)), x: b.pos.x - b.facing * 0.6 * Math.sin(t / 9), ground: 0 };
      }
      const e = easeOut(p);
      return { ...base(b), gaze, sx: 1 + 0.12 * e, sy: 1 - 0.16 * e, ground: 0 };
    }

    case "travel":
      return travelStep(b, now, dt, c);

    case "land": {
      const t = now - b.since;
      const scurry = c.variant === "scurry";
      const dur = scurry ? BEAT.LAND_MS_SCURRY : BEAT.LAND_MS;
      if (t >= dur) {
        enter(b, "attached", now);
        return stepBeat(b, now, dt, c);
      }
      const amp = scurry ? 5 : 4;
      const off = amp * Math.exp(-t / 70) * Math.cos((2 * Math.PI * 4.5 * t) / 1000);
      b.pos = { x: c.target.x + b.dir.x * off, y: c.target.y + Math.min(0, b.dir.y * off) };
      const squash = Math.exp(-t / 60) * Math.cos((2 * Math.PI * 5 * t) / 1000);
      const pose = base(b);
      if (scurry) {
        // Skid: leans back against the stop, then rights itself.
        pose.rot = -b.facing * 12 * Math.exp(-t / 90) * Math.cos((2 * Math.PI * 3 * t) / 1000);
        pose.sy = 1 - 0.08 * squash;
        pose.sx = 1 + 0.05 * squash;
      } else {
        pose.sy = 1 - 0.18 * squash;
        pose.sx = 1 + 0.1 * squash;
      }
      pose.gaze = t < 140 ? "look-down" : "rest";
      return pose;
    }

    case "follow": {
      const p = clamp01((now - b.since) / BEAT.FOLLOW_MS);
      b.pos = lerpPt(b.from, c.target, easeOutCubic(p));
      if (p >= 1) enter(b, "attached", now);
      return base(b);
    }

    case "fade": {
      const t = now - b.since;
      if (t < BEAT.FADE_MS) {
        b.pos = { ...b.from };
        return { ...base(b), opacity: 1 - t / BEAT.FADE_MS, ground: 0 };
      }
      b.pos = { ...c.target };
      if (b.dest && b.after === "gone") {
        enter(b, "gone", now);
        return { ...base(b), opacity: 0 };
      }
      if (t >= BEAT.FADE_MS * 2) {
        enter(b, "attached", now);
        return base(b);
      }
      return { ...base(b), opacity: (t - BEAT.FADE_MS) / BEAT.FADE_MS };
    }
  }
}

// ── phases ──────────────────────────────────────────────────────────────

/** The Wile E. Coyote fall. Unaware, uh-oh, a look at the viewer, then gravity. */
function coyoteStep(b: Beat, now: number, dt: number, c: Ctx): Pose {
  const camera = c.cameraLook ?? "hold";
  const v0 = b.vanishedAt ?? b.since;
  // Where each pre-drop beat starts, from the vanish. A figure that already
  // knew it was stranded skips straight to the uh-oh.
  const uhohAt = b.aware ? v0 : v0 + COYOTE.OBLIVIOUS_MS;
  const cameraAt = uhohAt + COYOTE.UHOH_MS;
  const dropAt = cameraAt + (camera === "off" ? 0 : COYOTE.CAMERA_MS);
  const pose = base(b);

  if (c.variant === "reduced") {
    if (b.phase !== "fadedown") {
      if (!b.dropReady) return pose;
      b.from = { ...b.pos };
      enter(b, "fadedown", now);
    }
    const t = now - b.since;
    if (t < BEAT.FADE_MS) return { ...pose, x: b.from.x, y: b.from.y, opacity: 1 - t / BEAT.FADE_MS };
    // Straight to where it would end up: the landing, or the better spot it would scurry to.
    b.pos = { ...(b.scurryTo ?? b.fallTo) };
    if (t >= BEAT.FADE_MS * 2) {
      if (b.scurryTo) {
        b.scurryTo = null;
        b.vanishedAt = null;
        b.dropReady = false;
        enter(b, "home", now);
        return base(b);
      }
      return settleDown(b, now);
    }
    return { ...base(b), opacity: (t - BEAT.FADE_MS) / BEAT.FADE_MS };
  }

  // The pre-drop beats run on the clock from the vanish; the drop also waits for the host's word.
  if (b.phase === "oblivious" || b.phase === "uhoh" || b.phase === "camera") {
    if (now >= dropAt && b.dropReady) {
      b.dropFrom = { ...b.pos };
      b.dropAt = now;
      enter(b, "drop", now);
    } else if (now >= cameraAt && camera !== "off") b.phase = "camera";
    else if (now >= uhohAt) b.phase = "uhoh";
  }

  switch (b.phase) {
    case "oblivious":
      return pose; // standing on nothing, none the wiser

    case "uhoh": {
      const t = now - uhohAt;
      if (t < COYOTE.UHOH_LOOK_MS) return { ...pose, gaze: "look-down" };
      const pt = t - COYOTE.UHOH_LOOK_MS;
      const pop = pt < COYOTE.UHOH_POP_MS ? Math.sin((Math.PI * pt) / COYOTE.UHOH_POP_MS) : 0;
      const stiff = Math.min(1, pt / COYOTE.UHOH_POP_MS);
      return {
        ...pose,
        gaze: "look-down",
        y: pose.y - 2 * pop,
        sy: 1 + 0.05 * stiff + 0.03 * pop,
        sx: 1 - 0.03 * stiff,
        x: pose.x + Math.sin(now / 11) * 0.3, // a held tremble
      };
    }

    case "camera": {
      // Wait here, looking out of the screen, until the host says gone.
      const t = now - cameraAt;
      const slump = easeOutCubic(clamp01(t / 200));
      const wave = camera === "wave" && t > 120 && t < 320;
      return { ...pose, gaze: "rest", facing: 1, sy: 1.05 - 0.08 * slump, sx: 0.97 + 0.04 * slump, wave };
    }

    case "drop": {
      const t = now - b.since;
      const y = b.dropFrom.y + 0.5 * COYOTE.GRAVITY * t * t;
      if (y >= b.fallTo.y) {
        b.pos = { ...b.fallTo };
        enter(b, "impact", now);
        return coyoteStep(b, now, dt, c);
      }
      b.pos = { x: b.fallTo.x, y };
      const v = COYOTE.GRAVITY * t;
      const stretch = Math.min(COYOTE.STRETCH_MAX, v * COYOTE.STRETCH_PER_V);
      return { ...base(b), gaze: "look-up", sy: 1 + stretch, sx: 1 - stretch * 0.6, rot: Math.sin(t / 40) * 3 * Math.min(1, t / 120) };
    }

    case "impact": {
      const p = clamp01((now - b.since) / COYOTE.IMPACT_MS);
      const k = 1 - easeOutCubic(p);
      if (p >= 1) {
        enter(b, "bounce", now);
        return coyoteStep(b, now, dt, c);
      }
      return { ...base(b), gaze: "blink-half", sy: 1 - COYOTE.SQUASH_Y * k, sx: 1 + COYOTE.SQUASH_X * k };
    }

    case "bounce": {
      const p = clamp01((now - b.since) / COYOTE.BOUNCE_MS);
      const fall = Math.max(0, b.fallTo.y - b.dropFrom.y);
      const h = clamp(fall * COYOTE.BOUNCE_PER_PX, COYOTE.BOUNCE_MIN, COYOTE.BOUNCE_MAX);
      if (p >= 1) {
        b.pos = { ...b.fallTo };
        enter(b, "dazed", now);
        return coyoteStep(b, now, dt, c);
      }
      b.pos = { x: b.fallTo.x, y: b.fallTo.y - h * 4 * p * (1 - p) };
      return { ...base(b), gaze: "blink-half", sy: 1 + 0.06 * bump(p), sx: 1 - 0.04 * bump(p) };
    }

    case "dazed": {
      const t = now - b.since;
      if (t >= COYOTE.DAZED_MS) {
        enter(b, "shake", now);
        return coyoteStep(b, now, dt, c);
      }
      const land = Math.exp(-t / 40); // the little second landing
      const decay = 1 - 0.5 * (t / COYOTE.DAZED_MS);
      return {
        ...base(b),
        gaze: "blink-half",
        rot: COYOTE.DAZE_DEG * decay * Math.sin((2 * Math.PI * COYOTE.DAZE_HZ * t) / 1000),
        x: b.pos.x + Math.sin((2 * Math.PI * COYOTE.DAZE_HZ * t) / 1000 + 1) * 1,
        sy: 1 - 0.12 * land,
        sx: 1 + 0.07 * land,
      };
    }

    case "shake": {
      const t = now - b.since;
      if (t >= COYOTE.SHAKE_MS) return settleDown(b, now);
      const p = t / COYOTE.SHAKE_MS;
      return { ...base(b), rot: COYOTE.SHAKE_DEG * (1 - p) * Math.sin((2 * Math.PI * COYOTE.SHAKE_HZ * t) / 1000) };
    }
  }
  return pose;
}

/** Landed and recovered: stay, or scurry somewhere better. */
function settleDown(b: Beat, now: number): Pose {
  b.vanishedAt = null;
  b.dropReady = false;
  if (b.scurryTo) {
    const to = b.scurryTo;
    b.scurryTo = null;
    putAway(b, now, to, "home");
  } else enter(b, "down", now);
  return base(b);
}

function gravityStep(b: Beat, now: number, dt: number, c: Ctx): void {
  if (now - b.moveStart < BEAT.SAG_AFTER_MS || b.caughtAt !== null) return;
  const room = Math.max(0, c.floorY - b.hang.y);
  if (c.variant === "float") {
    b.sag = Math.min(BEAT.SINK_PX, room, b.sag + BEAT.SINK_RATE * dt);
    return;
  }
  b.sagV += BEAT.GRAVITY * dt;
  b.sag += b.sagV * dt;
  const cap = Math.min(c.gravity === "nano" ? BEAT.NANO_PX : BEAT.DROP_PX, room);
  if (b.sag >= cap) {
    b.sag = cap;
    b.sagV = 0;
    b.caughtAt = now;
  }
}

const GLANCES: Gaze[] = ["look-left", "look-down-right", "look-right", "look-down-left"];

function strandedStill(b: Beat, now: number): Pose {
  return { ...base(b), ground: groundFade(b, now) };
}

function worryPose(b: Beat, now: number, c: Ctx): Pose {
  const pose = { ...base(b), ground: groundFade(b, now) };
  const u = now - b.moveStart - BEAT.HANG_MS;
  if (u < 0) return pose; // Off the cliff: nothing moves yet.

  // Falling: stretched, eyes down. Caught: a squash that rings out.
  if (b.sagV > 0 && b.caughtAt === null) {
    return { ...pose, gaze: "look-down", sy: 1.06, sx: 0.96 };
  }
  if (b.caughtAt !== null && c.variant !== "float") {
    const t = now - b.caughtAt;
    const s = Math.exp(-t / 70) * Math.cos((2 * Math.PI * 5 * t) / 1000);
    const k = c.gravity === "nano" ? 0.5 : 1;
    pose.sy = 1 - 0.14 * k * s;
    pose.sx = 1 + 0.08 * k * s;
  }

  const hoverT = u / 1000;
  pose.y += Math.sin(2 * Math.PI * BEAT.HOVER_HZ * hoverT) * BEAT.HOVER_PX;
  pose.x += Math.sin(2 * Math.PI * BEAT.TREMBLE_HZ * hoverT + b.index) * BEAT.TREMBLE_PX;

  if (u < BEAT.LOOK_DOWN_MS) {
    const k = bump(u / BEAT.LOOK_DOWN_MS);
    return { ...pose, gaze: "look-down", sy: pose.sy * (1 - 0.05 * k), y: pose.y + 0.6 * k };
  }
  const g = u - BEAT.LOOK_DOWN_MS + b.index * BEAT.GLANCE_OFFSET_MS;
  const k = Math.floor(g / BEAT.GLANCE_MS);
  const gaze = GLANCES[(k + b.seed) % GLANCES.length]!;
  const facing: 1 | -1 = gaze.endsWith("left") ? -1 : 1;
  b.facing = facing;
  // Each glance starts with a little snap of the head.
  const tt = g - k * BEAT.GLANCE_MS;
  const snap = tt < 70 ? 1 - tt / 70 : 0;
  return { ...pose, gaze, facing, rot: facing * 3 * snap };
}

function backToWorry(b: Beat, now: number, dt: number, c: Ctx): Pose {
  b.phase = "worry";
  b.spotAt = null;
  return stepBeat(b, now, dt, c);
}

function startTravel(b: Beat, now: number, c: Ctx): void {
  b.from = { ...b.pos };
  const dx = c.target.x - b.from.x;
  const dy = c.target.y - b.from.y;
  b.dist = Math.hypot(dx, dy);
  b.dir = b.dist > 0 ? { x: dx / b.dist, y: dy / b.dist } : { x: 1, y: 0 };
  if (Math.abs(dx) > 1) b.facing = dx < 0 ? -1 : 1;
  b.dur = travelMs(c.variant, b.dist);
  b.vel = { x: 0, y: 0 };
  enter(b, "travel", now);
}

function travelStep(b: Beat, now: number, dt: number, c: Ctx): Pose {
  const t = now - b.since;
  const tgt = c.target; // read live: if the window drifts, it chases
  if (c.variant === "float") {
    // Reeled in on a spring; the lag tilts it like something on a string.
    const s = Math.min(dt, 32) / 1000;
    const ax = BEAT.SPRING_K * (tgt.x - b.pos.x) - BEAT.SPRING_C * b.vel.x;
    const ay = BEAT.SPRING_K * (tgt.y - b.pos.y) - BEAT.SPRING_C * b.vel.y;
    b.vel = { x: b.vel.x + ax * s, y: b.vel.y + ay * s };
    b.pos = { x: b.pos.x + b.vel.x * s, y: b.pos.y + b.vel.y * s };
    const speed = Math.hypot(b.vel.x, b.vel.y);
    if (dist(b.pos, tgt) < 0.4 && speed < 6) {
      enter(b, "attached", now);
      return stepBeat(b, now, dt, c);
    }
    const near = dist(b.pos, tgt) < 10;
    return { ...base(b), rot: clamp(b.vel.x * 0.025, -9, 9), sy: 1 + clamp(speed / 6000, 0, 0.05), gaze: near ? "look-down" : gazeToward(b.pos, tgt) };
  }

  const p = clamp01(t / b.dur);
  if (c.variant === "hop") {
    const e = HOP_EASE(p);
    const h = hopHeight(b.dist);
    const ctrlY = Math.min(b.from.y, tgt.y) - 2 * h;
    const x = lerp(b.from.x, tgt.x, e);
    const y = (1 - e) * (1 - e) * b.from.y + 2 * (1 - e) * e * ctrlY + e * e * tgt.y;
    b.pos = { x, y };
    if (p >= 1) {
      b.pos = { ...tgt };
      enter(b, "land", now);
      return stepBeat(b, now, dt, c);
    }
    const arc = Math.sin(Math.PI * e);
    return { ...base(b), rot: b.facing * 10 * arc, sy: 1 + 0.1 * arc, sx: 1 - 0.06 * arc, gaze: e > 0.72 ? "look-down" : gazeToward(b.pos, tgt) };
  }

  // Scurry: strong ease-in off the mark, a short brake, a gravity dip mid-way.
  const e = SCURRY_EASE(p);
  const dip = b.dist > 40 ? 6 * Math.sin(Math.PI * e) : 0;
  b.pos = { x: lerp(b.from.x, tgt.x, e), y: lerp(b.from.y, tgt.y, e) + dip };
  if (p >= 1) {
    b.pos = { ...tgt };
    if (b.dest && b.after === "gone") {
      enter(b, "gone", now);
      return { ...base(b), opacity: 0 };
    }
    enter(b, "land", now);
    return stepBeat(b, now, dt, c);
  }
  const stride = (Math.floor(t / BEAT.STRIDE_MS) % 2) as 0 | 1;
  const bob = Math.abs(Math.sin((t / BEAT.STRIDE_MS) * Math.PI)) * 1.5;
  return { ...base(b), y: b.pos.y - bob, stride, rot: b.facing * 14 * Math.min(1, t / 80), trail: Math.sin(Math.PI * p) * 0.8, gaze: gazeToward(b.pos, tgt) };
}

// ── helpers ─────────────────────────────────────────────────────────────

function enter(b: Beat, phase: Phase, now: number): void {
  b.phase = phase;
  b.since = now;
}

function base(b: Beat): Pose {
  return { x: b.pos.x, y: b.pos.y, rot: 0, sx: 1, sy: 1, gaze: "rest", facing: b.facing, stride: null, opacity: 1, ground: 0, groundAt: b.hang, trail: 0 };
}

function groundFade(b: Beat, now: number): number {
  return clamp01(1 - (now - b.moveStart) / 300) * 0.9;
}

/** Eight-way gaze toward a point, y down. */
export function gazeToward(from: Pt, to: Pt): Gaze {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return "rest";
  const h = dx < 0 ? "left" : "right";
  if (Math.abs(dy) < 0.4 * Math.abs(dx)) return `look-${h}`;
  const v = dy > 0 ? "down" : "up";
  if (Math.abs(dx) < 0.4 * Math.abs(dy)) return `look-${v}`;
  return `look-${v}-${h}`;
}

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bx = (u: number) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const by = (u: number) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  const dbx = (u: number) => 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = bx(u) - t;
      if (Math.abs(err) < 1e-5) break;
      const d = dbx(u);
      if (Math.abs(d) < 1e-6) break;
      u = clamp01(u - err / d);
    }
    return by(u);
  };
}

/** Hop: slow lift, fast middle, eased landing. */
export const HOP_EASE = cubicBezier(0.5, 0, 0.3, 1);
/** Scurry: hard acceleration off the mark, abrupt brake. */
export const SCURRY_EASE = cubicBezier(0.55, 0, 0.1, 1);
/** The shipped fall (edge.css). */
export const FALL_EASE = cubicBezier(0.55, 0, 1, 0.45); // the shipped fall, kept for reference

function easeOut(p: number): number { return 1 - (1 - p) * (1 - p); }
function easeOutCubic(p: number): number { return 1 - Math.pow(1 - p, 3); }
function bump(p: number): number { return Math.sin(Math.PI * clamp01(p)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpPt(a: Pt, b: Pt, t: number): Pt { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }
function dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function clamp01(v: number): number { return clamp(v, 0, 1); }
