import { describe, expect, test } from "bun:test";

import type { CompanionFigure } from "../../lib/companion-host.ts";
import {
  figureHold,
  figurePose,
  figureMotion,
  figureNudge,
  figureBox,
  figureHasPlate,
  figureSize,
  figureSlot,
  figureWhere,
  hiddenFigures,
  isFigureClick,
  placedPopover,
  workPopoverSpot,
} from "./figure-model.ts";

const defaults = { size: 24, motion: "full" as const, hold: "iso" as const };

function figure(patch: Partial<CompanionFigure> = {}): CompanionFigure {
  return { workId: "work-1", size: null, motion: null, hidden: false, placement: { kind: "home" }, anchor: null, label: "Home row", ...patch };
}

describe("figure settings", () => {
  test("size and motion follow the defaults unless set; Reduce Motion forces still", () => {
    expect(figureSize(figure(), defaults)).toBe(24);
    expect(figureSize(figure({ size: 64 }), defaults)).toBe(64);
    expect(figureSize(undefined, { size: 32, motion: "calm", hold: "iso" })).toBe(32);
    expect(figureMotion(figure(), defaults, false)).toBe("full");
    expect(figureMotion(figure({ motion: "calm" }), defaults, false)).toBe("calm");
    expect(figureMotion(figure({ motion: "full" }), defaults, true)).toBe("still");
  });

  test("hit slots grow with the figure but never shrink below the classic slot", () => {
    expect(figureSlot(16)).toEqual({ width: 30, height: 26 });
    expect(figureSlot(24)).toEqual({ width: 30, height: 34 });
    expect(figureSlot(64)).toEqual({ width: 80, height: 74 });
  });

  test("hidden figures are counted for the mark", () => {
    expect(hiddenFigures([figure(), figure({ workId: "work-2", hidden: true })])).toEqual(["work-2"]);
  });
});

describe("where a figure shows", () => {
  const anchor = { x: 10, y: 10, down: "bottom" as const, covered: false, away: false };
  test("row, placed, waiting or hidden", () => {
    expect(figureWhere(undefined)).toBe("row");
    expect(figureWhere(figure())).toBe("row");
    expect(figureWhere(figure({ hidden: true, placement: { kind: "free", x: 0.5, y: 0.5 }, anchor }))).toBe("hidden");
    expect(figureWhere(figure({ placement: { kind: "free", x: 0.5, y: 0.5 }, anchor }))).toBe("placed");
    expect(figureWhere(figure({ placement: { kind: "free", x: 0.5, y: 0.5 }, anchor: { ...anchor, covered: true } }))).toBe("placed");
    expect(figureWhere(figure({ placement: { kind: "window", side: "top", t: 0.5 }, anchor: { ...anchor, away: true } }))).toBe("waiting");
    expect(figureWhere(figure({ placement: { kind: "window", side: "top", t: 0.5 }, anchor: null }))).toBe("waiting");
  });

  test("feet first", () => {
    const screen = { width: 1512, height: 982 };
    // 24px figure: slot 30×34.
    // Standing: feet at the anchor.
    expect(figureBox({ x: 500, y: 600, down: "bottom" }, 24, screen, "latch")).toEqual({ left: 485, top: 566, bodyTop: 576, bodyBottom: 600 });
    expect(figureBox({ x: 500, y: 600, down: null }, 24, screen, "latch")).toEqual({ left: 485, top: 566, bodyTop: 576, bodyBottom: 600 });
    // Under an edge: hangs 6 below it, body at the top of the slot.
    expect(figureBox({ x: 500, y: 300, down: "top" }, 24, screen, "latch")).toEqual({ left: 485, top: 306, bodyTop: 306, bodyBottom: 330 });
    // On a side: 6 off it, body centred on the anchor.
    expect(figureBox({ x: 0, y: 400, down: "left" }, 24, screen, "latch")).toEqual({ left: 6, top: 383, bodyTop: 388, bodyBottom: 412 });
    expect(figureBox({ x: 1512, y: 400, down: "right" }, 24, screen, "latch")).toEqual({ left: 1476, top: 383, bodyTop: 388, bodyBottom: 412 });
    expect([null, "bottom", "top", "left", "right"].filter((down) => figureHasPlate(down as never))).toEqual(["top", "left", "right"]);
  });

  test("iso: standing on a platform, feet just below the anchor on a side", () => {
    const screen = { width: 1512, height: 982 };
    // Standing and under an edge, the same as a latch.
    expect(figureBox({ x: 500, y: 600, down: "bottom" }, 24, screen, "iso")).toEqual(figureBox({ x: 500, y: 600, down: "bottom" }, 24, screen, "latch"));
    expect(figureBox({ x: 500, y: 300, down: "top" }, 24, screen, "iso")).toEqual(figureBox({ x: 500, y: 300, down: "top" }, 24, screen, "latch"));
    // On a side: the slot rises 0.72 of its 34pt above the anchor; the body stands at its bottom.
    const left = figureBox({ x: 0, y: 400, down: "left" }, 24, screen, "iso");
    expect(left.left).toBe(6);
    expect(left.top).toBeCloseTo(375.52);
    expect(left.bodyBottom).toBeCloseTo(409.52);
    // The host's cover probe (8pt out, at the anchor's height) lands on the body.
    expect(left.bodyTop).toBeLessThan(400);
    expect(left.bodyBottom).toBeGreaterThan(400);
    expect(figureBox({ x: 1512, y: 400, down: "right" }, 24, screen, "iso")).toMatchObject({ left: 1476 });
    // Near the bottom it still slides up to stay on screen.
    expect(figureBox({ x: 0, y: 975, down: "left" }, 24, screen, "iso").top).toBe(948);
  });

  test("a held figure slides along its edge to stay on screen, never off its plate", () => {
    const screen = { width: 1512, height: 982 };
    // Under the top of the screen near a corner: slides along the edge, still hangs 6 below it.
    expect(figureBox({ x: 4, y: 33, down: "top" }, 24, screen, "latch")).toMatchObject({ left: 0, top: 39 });
    // Near the right corner it leaves room for the state plate that overhangs the body.
    const corner = figureBox({ x: 1481.76, y: 33, down: "top" }, 64, screen, "latch");
    // Scaled 1.06 in the needs pose, about the body's centre.
    expect(corner.left + 80 / 2 + (64 / 2 + 64 * 0.24) * 1.06).toBeLessThanOrEqual(1512);
    // Beside a side near the bottom: slides up, still 6 off the edge.
    expect(figureBox({ x: 0, y: 975, down: "left" }, 24, screen, "latch")).toMatchObject({ left: 6, top: 948 });
    // Never pulled away from its edge, even if that runs off screen.
    expect(figureBox({ x: 1490, y: 400, down: "left" }, 64, screen, "latch").left).toBe(1496);
    // The host's 8pt cover probe lands on the body, not in the gap.
    expect(figureBox({ x: 500, y: 300, down: "top" }, 24, screen, "latch").bodyTop).toBeLessThanOrEqual(308);
  });
});

describe("input", () => {
  test("a press that moved more than 4pt is a drag, not a click", () => {
    expect(isFigureClick({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(true);
    expect(isFigureClick({ x: 0, y: 0 }, { x: 4, y: 3 })).toBe(false);
    expect(isFigureClick(null, { x: 40, y: 40 })).toBe(true);
  });

  test("arrows nudge 1pt, 10pt with shift", () => {
    expect(figureNudge("ArrowLeft", false)).toEqual({ dx: -1, dy: 0 });
    expect(figureNudge("ArrowDown", true)).toEqual({ dx: 0, dy: 10 });
    expect(figureNudge("Enter", false)).toBeNull();
  });
});

describe("placed popover", () => {
  const screen = { width: 1512, height: 982 };
  test("above a figure with room, below one near the top, always on screen", () => {
    expect(placedPopover({ x: 700, y: 600, down: "bottom" }, 24, 348, screen, "latch")).toEqual({ left: 526, bottom: 418, maxHeight: 552 });
    expect(placedPopover({ x: 20, y: 60, down: "bottom" }, 24, 348, screen, "latch")).toEqual({ left: 12, top: 72, maxHeight: 898 });
    // Under the top edge: the body hangs below the plate.
    expect(placedPopover({ x: 1500, y: 33, down: "top" }, 24, 348, screen, "latch")).toEqual({ left: 1152, top: 75, maxHeight: 895 });
    // On a side: the body is centred on the anchor.
    expect(placedPopover({ x: 1500, y: 600, down: "right" }, 24, 348, screen, "latch")).toEqual({ left: 1152, bottom: 406, maxHeight: 564 });
  });
});

describe("work popover spot", () => {
  test("a placed figure opens beside its anchor even with no home-row spot or overflow stack", () => {
    const anchor = { x: 640, y: 300, down: "bottom" as const, covered: false, away: false };
    expect(workPopoverSpot(null, anchor)).toEqual({ x: 640, placed: anchor });
    expect(workPopoverSpot(undefined, anchor)).toEqual({ x: 640, placed: anchor });
    // The anchor wins over a stale row or "+N" position.
    expect(workPopoverSpot(90, anchor)).toEqual({ x: 640, placed: anchor });
    expect(workPopoverSpot(90, null)).toEqual({ x: 90, placed: null });
    expect(workPopoverSpot(null, null)).toBeNull();
  });
});

// Edge contacts are expressed in original master pixels; no floaty hold gap.
describe("authored Edge attachment", () => {
  const screen = { width: 1512, height: 982 };
  test("hands meet top/menu-bar edge at 24 and 44, independent of canvas padding", () => {
    const art = { w: 492, h: 512, contact: [246, 30] as const };
    for (const size of [24, 44]) {
      const box = figureBox({ x: 800, y: 28, down: "top" }, size, screen, "edge", art);
      expect(box.bodyTop + art.contact[1] * size / 512).toBeCloseTo(28);
      expect(box.bodyLeft! + art.contact[0] * size / 512).toBeCloseTo(800);
      expect(box.bodyOffsetY).toBe(5);
    }
  });
  test("side fingertips meet the edge, rather than a six-point air gap", () => {
    for (const down of ["left", "right"] as const) {
      const art = { w: 512, h: 512, contact: [down === "left" ? 128 : 384, 180] as const };
      const x = down === "left" ? 0 : screen.width;
      const box = figureBox({ x, y: 400, down }, 44, screen, "edge", art);
      expect(box.bodyLeft! + art.contact[0] * 44 / 512).toBeCloseTo(x);
      expect(box.bodyTop + art.contact[1] * 44 / 512).toBeCloseTo(400);
    }
  });
  test("seat touches window top and boots baseline touches floor", () => {
    for (const contactY of [369, 492]) {
      const art = { w: 516, h: 512, contact: [258, contactY] as const };
      const box = figureBox({ x: 500, y: 600, down: "bottom" }, 44, screen, "edge", art);
      expect(box.bodyTop + contactY * 44 / 512).toBeCloseTo(600);
    }
  });
  test("legacy Edge request without art keeps platform geometry", () => {
    for (const down of ["top", "left", "right"] as const) {
      expect(figureBox({ x: 500, y: 300, down }, 24, screen, "edge"))
        .toEqual(figureBox({ x: 500, y: 300, down }, 24, screen, "iso"));
    }
  });
});

test("Edge chooses contact poses, honors saved holds, and falls back for unknown crew", () => {
  const edge = { ...defaults, hold: "edge" as const };
  expect(figureHold(figure({ hold: "latch" }), edge, "milo")).toBe("latch");
  expect(figureHold(figure(), edge, "unknown")).toBe("iso");
  expect(figureHold(figure(), edge, "milo")).toBe("edge");
  expect(figurePose({ down: "top" })).toBe("hang-from-top");
  expect(figurePose({ down: "left" })).toBe("cling-left");
  expect(figurePose({ down: "right" })).toBe("cling-right");
  expect(figurePose({ down: "bottom" })).toBe("rest");
  const ledge = figure({ placement: { kind: "window", side: "top", t: .5 } });
  expect(figurePose({ down: "bottom" }, ledge)).toBe("sit-on-ledge");
  expect(figurePose({ down: "top", attachment: "hang" }, figure({ ...ledge, windowTop: "hang" }))).toBe("hang-from-top");
  expect(figurePose({ down: null }, ledge)).toBe("rest");
  expect(figurePose({ down: "bottom", attachment: "stand" }, ledge)).toBe("rest");
  expect(figurePose({ down: "left", attachment: "grip" }, ledge)).toBe("cling-left");
});
