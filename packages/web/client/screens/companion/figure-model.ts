/**
 * Figures you place: what the page decides for a pinned figure the operator
 * can drag anywhere on its display. The host owns placement (it reads the
 * windows and the modifier keys); this module only turns the host's answers
 * into sizes, motion, layers and popover spots.
 *
 * Pure functions only, so it is testable without a DOM.
 */

import type {
  CompanionFigure,
  CompanionFigureAnchor,
  CompanionFigureDefaults,
  CompanionFigureHold,
  CompanionFigureMotion,
  CompanionSide,
} from "../../lib/companion-host.ts";
import { hasEdgePoses, type EdgePoseArt, type EdgePoseName } from "../../lib/crew-registry.ts";
import { EDGE_SLOT } from "./edge-model.ts";

export const FIGURE_SIZE_PRESETS = [16, 24, 32, 48, 64] as const;
export const FIGURE_MOTIONS: readonly CompanionFigureMotion[] = ["full", "calm", "still"];
export const FIGURE_MOTION_LABEL: Record<CompanionFigureMotion, string> = { full: "Full", calm: "Calm", still: "Still" };
export const FIGURE_HOLD_LABEL: Record<CompanionFigureHold, string> = { edge: "Edge", iso: "Platform", latch: "Latch" };
/** A press that moves this far or less is a click, as on the host. */
export const FIGURE_CLICK_SLOP = 4;
/** The ⇧ fall, and a window that went away. Ease-in; instant under Reduce Motion. */
export const FIGURE_FALL_MS = 520;
export const FIGURE_LAND_MS = 120;

export function figureSize(figure: CompanionFigure | undefined, defaults: CompanionFigureDefaults): number {
  return figure?.size ?? defaults.size;
}

/** Reduce Motion forces Still, whatever the figure says. */
export function figureMotion(figure: CompanionFigure | undefined, defaults: CompanionFigureDefaults, reduced: boolean): CompanionFigureMotion {
  return reduced ? "still" : figure?.motion ?? defaults.motion;
}

/** Hit target for a figure: never narrower than the classic slot. */
export function figureSlot(size: number): { width: number; height: number } {
  return { width: Math.max(EDGE_SLOT, Math.round(size * 1.25)), height: size + 10 };
}

/**
 * Where a pinned or surfaced figure shows:
 *   row     — in the home row by the mark
 *   placed  — where the operator put it (the host gave its anchor)
 *   waiting — placed, but its spot is unknown or its window is on another Space
 *   hidden  — the operator hid it
 * Surfaced work has no figure settings and always stands in the row.
 */
export type FigureWhere = "row" | "placed" | "waiting" | "hidden";

export function figureWhere(figure: CompanionFigure | undefined): FigureWhere {
  if (!figure) return "row";
  if (figure.hidden) return "hidden";
  if (figure.placement.kind === "home") return "row";
  if (!figure.anchor || figure.anchor.away) return "waiting";
  return "placed";
}

/**
 * How far a held figure sits off its edge: room for the latch, or the gap an
 * iso platform floats across. Kept under the host's 8pt cover probe
 * (ghostOffset), so that probe lands on the body, not the gap.
 */
export const FIGURE_HOLD_REACH = 6;
/**
 * Iso on a side: the figure stands on its platform with its feet a little
 * below the anchor, so the slot rises this share of its height above it.
 */
export const FIGURE_ISO_RISE = 0.72;
/** How far the state plate overhangs the body's side, × size (edge.css .ce-fig__plate). */
export const FIGURE_STATE_PLATE_OVERHANG = 0.24;

/** Saved per-pin choice wins; a missing art pack must never produce an invisible grip. */
export function figureHold(figure: CompanionFigure | undefined, defaults: CompanionFigureDefaults, slug?: string | null): CompanionFigureHold {
  const hold = figure?.hold ?? defaults.hold;
  return hold === "edge" && !hasEdgePoses(slug) ? "iso" : hold;
}

export function figurePose(anchor: Pick<CompanionFigureAnchor, "down" | "attachment">, figure?: CompanionFigure): EdgePoseName | "rest" {
  if (anchor.down === null) return "rest";
  if (anchor.attachment === "stand") return "rest";
  if (anchor.attachment === "sit" || (!anchor.attachment && figure?.placement.kind === "window" && figure.placement.side === "top" && figure.windowTop !== "hang")) return "sit-on-ledge";
  if (anchor.attachment === "hang" || anchor.down === "top") return "hang-from-top";
  if (anchor.down === "left") return "cling-left";
  if (anchor.down === "right") return "cling-right";
  return "rest";
}

export type FigureBox = { left: number; top: number; bodyTop: number; bodyBottom: number;
  /** Edge art offsets in the hit slot. Absent for unchanged legacy geometry. */
  bodyLeft?: number; bodyOffsetX?: number; bodyOffsetY?: number; contactX?: number; contactY?: number;
};

export type FigureHoldSide = "top" | "left" | "right";

/** Whether a figure on this edge holds on (platform or latch) rather than standing. */
export function figureHasPlate(down: CompanionSide | null): down is FigureHoldSide {
  return down === "top" || down === "left" || down === "right";
}

/**
 * Held figures stay upright on every edge, so they never have to be read at a
 * tilt. On a floor or a title bar (down "bottom", or none while dragged) a
 * figure stands with its feet at the anchor. Under an edge or on a side it
 * holds on, by the operator's hold:
 *   latch — a slim glass latch across the edge line; the figure hangs below
 *           it, or clips on beside it centred on the anchor.
 *   iso   — a glass isometric platform floating off the edge; the figure
 *           stands on it, below an edge, or beside a side with its feet
 *           FIGURE_ISO_RISE down the slot (just below the anchor).
 * The body sits inside its slot by edge.css .is-hold-*.
 *
 * Returns the slot's top-left and the body's vertical extent, in page px.
 */
export function figureBox(
  anchor: Pick<CompanionFigureAnchor, "x" | "y" | "down">,
  size: number,
  screen: { width: number; height: number },
  hold: CompanionFigureHold,
  art?: EdgePoseArt,
): FigureBox {
  const slot = figureSlot(size);
  if (hold === "edge" && art) {
    const k = size / art.h;
    const w = art.w * k;
    const offsetX = (slot.width - w) / 2;
    const offsetY = (slot.height - size) / 2;
    let left = anchor.x - art.contact[0] * k - offsetX;
    let top = anchor.y - art.contact[1] * k - offsetY;
    // Only slide ALONG the contact edge. Never add the legacy six-point air gap.
    if (anchor.down === "top" || anchor.down === "bottom") left = Math.max(0, Math.min(screen.width - slot.width, left));
    if (anchor.down === "left" || anchor.down === "right") top = Math.max(0, Math.min(screen.height - slot.height, top));
    return { left, top, bodyLeft: left + offsetX, bodyTop: top + offsetY, bodyBottom: top + offsetY + size,
      bodyOffsetX: offsetX, bodyOffsetY: offsetY, contactX: art.contact[0] * k, contactY: art.contact[1] * k };
  }
  const gap = FIGURE_HOLD_REACH;
  const side = hold !== "latch"
    ? { top: anchor.y - slot.height * FIGURE_ISO_RISE, bodyOffset: slot.height - size }
    : { top: anchor.y - slot.height / 2, bodyOffset: (slot.height - size) / 2 };
  let left: number;
  let top: number;
  let bodyOffset: number; // body top, from the slot's top
  switch (anchor.down) {
    case "top":
      left = anchor.x - slot.width / 2; top = anchor.y + gap; bodyOffset = 0; break;
    case "left":
      left = anchor.x + gap; top = side.top; bodyOffset = side.bodyOffset; break;
    case "right":
      left = anchor.x - gap - slot.width; top = side.top; bodyOffset = side.bodyOffset; break;
    default:
      left = anchor.x - slot.width / 2; top = anchor.y - slot.height; bodyOffset = slot.height - size;
  }
  // Slide along the held edge to stay on screen, never away from it: the
  // figure stays on its hold and over the host's cover probe. Standing
  // figures keep their feet on the anchor, as the host placed them.
  // Under an edge the state plate overhangs the body's right side
  // (edge.css .ce-fig__plate: right -0.24 × size); keep room for it too.
  if (anchor.down === "top") {
    // Body and plate scale 1.06 about the body's centre in the needs pose; 2pt spare.
    const plateRight = slot.width / 2 + (size / 2 + size * FIGURE_STATE_PLATE_OVERHANG) * 1.06 + 2;
    left = Math.max(0, Math.min(screen.width - Math.max(slot.width, plateRight), left));
  }
  if (anchor.down === "left" || anchor.down === "right") top = Math.max(0, Math.min(screen.height - slot.height, top));
  return { left, top, bodyTop: top + bodyOffset, bodyBottom: top + bodyOffset + size };
}

/** A drag the host tracked is not also a click on the figure. */
export function isFigureClick(down: { x: number; y: number } | null, up: { x: number; y: number }): boolean {
  if (!down) return true;
  return Math.hypot(up.x - down.x, up.y - down.y) <= FIGURE_CLICK_SLOP;
}

/** Arrow keys nudge a placed figure 1pt, 10pt with ⇧. Page +y is down. */
export function figureNudge(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case "ArrowLeft": return { dx: -step, dy: 0 };
    case "ArrowRight": return { dx: step, dy: 0 };
    case "ArrowUp": return { dx: 0, dy: -step };
    case "ArrowDown": return { dx: 0, dy: step };
    default: return null;
  }
}

/**
 * A popover beside a placed figure: above it when there is room, else below,
 * kept on screen horizontally. `size` is the figure's height.
 */
export function placedPopover(
  anchor: Pick<CompanionFigureAnchor, "x" | "y" | "down">,
  size: number,
  popWidth: number,
  screen: { width: number; height: number },
  hold: CompanionFigureHold,
  margin = 12,
  art?: EdgePoseArt,
): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const left = Math.max(margin, Math.min(screen.width - popWidth - margin, anchor.x - popWidth / 2));
  const { bodyTop, bodyBottom } = figureBox(anchor, size, screen, hold, art);
  const above = bodyTop - margin * 2;
  const below = screen.height - bodyBottom - margin * 2;
  if (above >= Math.min(320, below) || above >= 240) {
    return { left, bottom: screen.height - bodyTop + margin, maxHeight: Math.max(120, above) };
  }
  return { left, top: bodyBottom + margin, maxHeight: Math.max(120, below) };
}

/**
 * Where a work popover opens. A placed figure opens beside its own anchor,
 * whatever the home row is doing; a row figure opens above its spot (or the
 * "+N" slot it overflowed into). null: nowhere to open it.
 */
export function workPopoverSpot<A extends { x: number }>(
  rowX: number | null | undefined,
  placed: A | null | undefined,
): { x: number; placed: A | null } | null {
  if (placed) return { x: placed.x, placed };
  if (rowX === null || rowX === undefined) return null;
  return { x: rowX, placed: null };
}

/** Pinned figures the operator hid, for the mark's "N hidden". */
export function hiddenFigures(figures: readonly CompanionFigure[]): string[] {
  return figures.filter((figure) => figure.hidden).map((figure) => figure.workId);
}
