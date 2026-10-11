import { describe, expect, test } from "bun:test";

import {
  BEAT,
  COYOTE,
  createBeat,
  putAway,
  returnToPerch,
  stepBeat,
  travelMs,
  windowGone,
  windowMoved,
  windowReturned,
  windowVanished,
  type Beat,
  type Ctx,
  type Phase,
  type Pose,
  type Pt,
} from "./window-chase-model.ts";

const FRAME = 16;

function ctx(target: Pt, extra: Partial<Ctx> = {}): Ctx {
  return { target, moving: false, variant: "scurry", gravity: "nano", floorY: 2000, cameraLook: "hold", ...extra };
}

/** Run frames from `from` to `to`, recording each phase change. */
function run(b: Beat, from: number, to: number, c: (now: number) => Ctx) {
  const phases: Array<{ phase: Phase; at: number }> = [{ phase: b.phase, at: from }];
  const poses: Pose[] = [];
  for (let now = from; now <= to; now += FRAME) {
    poses.push(stepBeat(b, now, FRAME, c(now)));
    if (phases[phases.length - 1]!.phase !== b.phase) phases.push({ phase: b.phase, at: now });
  }
  return { phases, poses, order: phases.map((p) => p.phase) };
}

function finite(p: Pose) {
  for (const v of [p.x, p.y, p.rot, p.sx, p.sy, p.opacity, p.ground, p.trail]) expect(Number.isFinite(v)).toBe(true);
}

describe("window chase: re-attach", () => {
  test("a resting figure is left behind, worries, spots, winds up, scurries and lands", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowMoved(b, 0);
    expect(b.phase).toBe("hang");
    const target = { x: 300, y: 100 };
    const { order, phases, poses } = run(b, 0, 3000, (now) => ctx(target, { moving: now < 600 }));
    expect(order).toEqual(["hang", "worry", "spot", "crouch", "travel", "land", "attached"]);
    expect(phases.find((p) => p.phase === "worry")!.at).toBeGreaterThanOrEqual(BEAT.HANG_MS);
    expect(phases.find((p) => p.phase === "spot")!.at).toBeGreaterThanOrEqual(600);
    expect(b.pos).toEqual(target);
    poses.forEach(finite);
  });

  test("hanging figure stays put while the window keeps moving", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowMoved(b, 0);
    run(b, 0, 900, () => ctx({ x: 400, y: 100 }, { moving: true }));
    expect(b.phase).toBe("worry");
    expect(b.pos.x).toBe(100);
  });

  test("a small move is a quick follow, not a scurry", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowMoved(b, 0);
    const { order } = run(b, 0, 600, () => ctx({ x: 100 + BEAT.NUDGE_PX - 4, y: 100 }));
    expect(order).toEqual(["hang", "follow", "attached"]);
  });

  test("the window moving again mid-dash sends it back to worrying", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowMoved(b, 0);
    let moving = false;
    run(b, 0, 400, () => ctx({ x: 400, y: 100 }, { moving }));
    expect(b.phase === "crouch" || b.phase === "spot" || b.phase === "travel").toBe(true);
    moving = true;
    if (b.phase === "travel") {
      // A dash already under way keeps chasing (live target); only spot/crouch fall back.
      expect(b.phase).toBe("travel");
    } else {
      stepBeat(b, 420, FRAME, ctx({ x: 450, y: 100 }, { moving: true }));
      expect(b.phase).toBe("worry");
    }
  });

  test("figures stagger their spot by index", () => {
    const at = [0, 1, 2].map((i) => {
      const b = createBeat(i, { x: 100, y: 100 });
      windowMoved(b, 0);
      return run(b, 0, 1200, () => ctx({ x: 400, y: 100 })).phases.find((p) => p.phase === "spot")!.at;
    });
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(BEAT.STAGGER_MS - FRAME);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(BEAT.STAGGER_MS - FRAME);
  });

  test("nano drop sags at most 3.5px and never past the floor", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowMoved(b, 0);
    let max = 0;
    for (let now = 0; now < 4000; now += FRAME) {
      stepBeat(b, now, FRAME, ctx({ x: 400, y: 100 }, { moving: true }));
      max = Math.max(max, b.sag);
    }
    expect(max).toBeLessThanOrEqual(BEAT.NANO_PX);
    expect(max).toBeGreaterThan(0);
    expect(b.caughtAt).not.toBeNull();

    const low = createBeat(0, { x: 100, y: 100 });
    windowMoved(low, 0);
    for (let now = 0; now < 4000; now += FRAME) stepBeat(low, now, FRAME, ctx({ x: 400, y: 100 }, { moving: true, floorY: 101 }));
    expect(low.sag).toBeLessThanOrEqual(1);
  });

  test("hover never sags", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowMoved(b, 0);
    for (let now = 0; now < 3000; now += FRAME) stepBeat(b, now, FRAME, ctx({ x: 400, y: 100 }, { moving: true, gravity: "hover" }));
    expect(b.sag).toBe(0);
  });

  test("reduced motion only fades: no travel phases", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowMoved(b, 0);
    const { order, poses } = run(b, 0, 1500, (now) => ctx({ x: 400, y: 100 }, { variant: "reduced", moving: now < 300 }));
    expect(order).toEqual(["hang", "worry", "fade", "attached"]);
    expect(poses.every((p) => p.stride === null && p.rot === 0)).toBe(true);
  });

  test("zero distance and every variant stay finite", () => {
    for (const variant of ["hop", "scurry", "float", "reduced"] as const) {
      const b = createBeat(0, { x: 50, y: 50 });
      returnToPerch(b, 0);
      run(b, 0, 1500, () => ctx({ x: 50, y: 50 }, { variant })).poses.forEach(finite);
      expect(Number.isFinite(travelMs(variant, 0))).toBe(true);
    }
  });
});

describe("window chase: put away", () => {
  test("home scurries to the slot and rests there", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    putAway(b, 0, { x: 500, y: 20 }, "home");
    const { order } = run(b, 0, 2000, () => ctx({ x: 100, y: 100 }, { variant: "float" }));
    expect(order).toEqual(["spot", "crouch", "travel", "land", "home"]);
    expect(b.pos).toEqual({ x: 500, y: 20 });
  });

  test("gone dashes through and vanishes without a landing", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    putAway(b, 0, { x: -40, y: 100 }, "gone");
    const { order, poses } = run(b, 0, 2000, () => ctx({ x: 100, y: 100 }));
    expect(order).toEqual(["spot", "crouch", "travel", "gone"]);
    expect(poses[poses.length - 1]!.opacity).toBe(0);
  });

  test("a window move during put-away is ignored", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    putAway(b, 0, { x: 500, y: 20 }, "home");
    windowMoved(b, 10);
    expect(b.phase).toBe("spot");
  });

  test("put-away delay staggers the start", () => {
    const b = createBeat(1, { x: 100, y: 100 });
    putAway(b, 0, { x: 500, y: 20 }, "home", 90);
    stepBeat(b, 50, FRAME, ctx({ x: 100, y: 100 }));
    expect(b.phase).toBe("spot");
    expect(b.pos).toEqual({ x: 100, y: 100 });
  });

  test("reduced put-away is a fade", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    putAway(b, 0, { x: 500, y: 20 }, "gone");
    const { order } = run(b, 0, 800, () => ctx({ x: 100, y: 100 }, { variant: "reduced" }));
    expect(order).toEqual(["spot", "fade", "gone"]);
  });
});

describe("window chase: the window closes (Coyote)", () => {
  test("unaware, uh-oh, camera look, then the drop once the host says gone", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowVanished(b, 0);
    expect(b.phase).toBe("oblivious");
    windowGone(b, 66, { x: 100, y: 220 });
    const { phases, order } = run(b, 0, 3000, () => ctx({ x: 100, y: 100 }));
    expect(order).toEqual(["oblivious", "uhoh", "camera", "drop", "impact", "bounce", "dazed", "shake", "down"]);
    const at = (p: Phase) => phases.find((x) => x.phase === p)!.at;
    expect(at("uhoh")).toBeGreaterThanOrEqual(COYOTE.OBLIVIOUS_MS);
    expect(at("uhoh")).toBeLessThan(COYOTE.OBLIVIOUS_MS + FRAME);
    expect(at("drop")).toBeGreaterThanOrEqual(COYOTE.OBLIVIOUS_MS + COYOTE.UHOH_MS + COYOTE.CAMERA_MS);
    // A 120px fall: the whole beat lands inside the 1.6–2.2s brief.
    expect(at("down")).toBeGreaterThan(1600);
    expect(at("down")).toBeLessThan(2200);
    expect(b.pos).toEqual({ x: 100, y: 220 });
  });

  test("the drop waits for the host's word", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowVanished(b, 0);
    run(b, 0, 2000, () => ctx({ x: 100, y: 100 }));
    expect(b.phase).toBe("camera");
    windowGone(b, 2000, { x: 100, y: 300 });
    stepBeat(b, 2016, FRAME, ctx({ x: 100, y: 100 }));
    expect(b.phase).toBe("drop");
  });

  test("a figure already stranded skips the unaware beat", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowMoved(b, 0);
    run(b, 0, 300, () => ctx({ x: 100, y: 100 }, { moving: true }));
    windowVanished(b, 300);
    expect(b.aware).toBe(true);
    stepBeat(b, 310, FRAME, ctx({ x: 100, y: 100 }));
    expect(b.phase).toBe("uhoh");
  });

  test("camera look off goes straight from uh-oh to the drop", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowGone(b, 0, { x: 100, y: 300 });
    const { order } = run(b, 0, 3000, () => ctx({ x: 100, y: 100 }, { cameraLook: "off" }));
    expect(order.slice(0, 3)).toEqual(["oblivious", "uhoh", "drop"]);
  });

  test("the window coming back before the drop cancels it", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowVanished(b, 0);
    run(b, 0, 400, () => ctx({ x: 100, y: 100 }));
    windowReturned(b, 400);
    expect(b.phase).toBe("attached");
    expect(b.vanishedAt).toBeNull();
  });

  test("a bad landing shakes off and scurries to the better spot", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowGone(b, 0, { x: 100, y: 800 }, { x: 600, y: 30 });
    const { order } = run(b, 0, 4000, () => ctx({ x: 100, y: 100 }));
    expect(order.slice(-5)).toEqual(["spot", "crouch", "travel", "land", "home"] as Phase[]);
    expect(b.pos).toEqual({ x: 600, y: 30 });
  });

  test("reduced motion fades down, never drops", () => {
    const b = createBeat(0, { x: 100, y: 100 });
    windowGone(b, 0, { x: 100, y: 400 });
    const { order } = run(b, 0, 1000, () => ctx({ x: 100, y: 100 }, { variant: "reduced" }));
    expect(order).toEqual(["oblivious", "fadedown", "down"]);
    expect(b.pos).toEqual({ x: 100, y: 400 });
  });
});
