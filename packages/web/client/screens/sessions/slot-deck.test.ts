import { describe, expect, test } from "bun:test";
import { createDefaultLaneDeck, type LaneDeckState } from "../ops/lane-deck.ts";
import { createSlotDeck, deserializeSlotDeck, migrateLaneDeck, orderedSlots, slotDeckReducer as reduce, slotSelection, slotWidth } from "./slot-deck.ts";
const a = { sessionRef: "session-a" }; const b = { sessionRef: "session-b" };

describe("session slot reducer", () => {
  test("select changes only the filter selection, never the slot order", () => {
    const deck = createSlotDeck(); const next = reduce(deck, { type: "select", slotId: "sessions-source", selection: a });
    expect(next.selections["sessions-source"]).toEqual(a); expect(next.slots).toBe(deck.slots);
    expect(deck.selections).toEqual({});
  });
  test("follow swaps immediately with the source's selection", () => {
    const deck = createSlotDeck("desk", a);
    expect(slotSelection(deck, "sessions-detail")).toEqual(a);
    expect(slotSelection(reduce(deck, { type: "select", slotId: "sessions-source", selection: b }), "sessions-detail")).toEqual(b);
  });
  test("a pin holds while a following neighbor moves", () => {
    const deck = createSlotDeck("mix", a);
    const next = reduce(deck, { type: "select", slotId: "sessions-source", selection: b });
    expect(slotSelection(next, "sessions-detail")).toEqual(b); expect(slotSelection(next, "sessions-pin")).toEqual(a);
    expect(reduce(next, { type: "select", slotId: "sessions-pin", selection: b })).toBe(next);
  });
  test("tear-out appends a pin without changing its original follow or the source", () => {
    const deck = createSlotDeck("board", a);
    const torn = reduce(deck, { type: "tear-out", slotId: "sessions-detail", newId: "frozen" });
    expect(torn.slots.slice(0, 2)).toEqual(deck.slots);
    expect(torn.slots[2].identity).toEqual({ kind: "pin", target: { kind: "session", session: a } });
    const moved = reduce(torn, { type: "select", slotId: "sessions-source", selection: b });
    expect(slotSelection(moved, "frozen")).toEqual(a); expect(slotSelection(moved, "sessions-detail")).toEqual(b);
  });
  test("cannot tear an empty follow, a pin, or overwrite a slot", () => {
    const empty = createSlotDeck(); expect(reduce(empty, { type: "tear-out", slotId: "sessions-detail", newId: "x" })).toBe(empty);
    const deck = createSlotDeck("mix", a);
    expect(reduce(deck, { type: "tear-out", slotId: "sessions-pin", newId: "x" })).toBe(deck);
    expect(reduce(deck, { type: "tear-out", slotId: "sessions-detail", newId: "sessions-source" })).toBe(deck);
  });
  test.each(["desk", "focus", "board", "mix"] as const)("preset %s loads a slot list and selection", (preset) => {
    const next = reduce(createSlotDeck(), { type: "preset", preset, selection: a });
    expect(next.preset).toBe(preset); expect(slotSelection(next, "sessions-detail")).toEqual(a);
    expect(deserializeSlotDeck(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  test("preset dimensions and primitives are data", () => {
    expect(createSlotDeck("desk").slots[1]).toMatchObject({ density: "desk", inspector: true });
    expect(createSlotDeck("focus").slots[1].density).toBe("reading");
    expect(createSlotDeck("board").slots.map((s) => s.density)).toEqual(["cards", "sheet"]);
    expect(createSlotDeck("mix").slots[0]).toMatchObject({ primitive: "lane", identity: { kind: "filter", filter: { scope: "working_asks" } } });
  });
  test("load restores a saved custom list without rebuilding it", () => {
    const saved = reduce(createSlotDeck("focus", a), { type: "tear-out", slotId: "sessions-detail", newId: "pin" });
    expect(reduce(createSlotDeck(), { type: "load", deck: saved })).toBe(saved);
  });
  test("missing sources and cycles fail closed", () => {
    const deck = createSlotDeck(); deck.slots[0].identity = { kind: "follow", slotId: "sessions-detail" };
    expect(slotSelection(deck, "sessions-detail")).toBeNull(); expect(slotSelection(deck, "missing")).toBeNull();
  });
  test("removing a source freezes its followers", () => {
    const next = reduce(createSlotDeck("desk", a), { type: "remove", slotId: "sessions-source" });
    expect(next.slots).toHaveLength(1); expect(slotSelection(next, "sessions-detail")).toEqual(a);
    expect(next.slots[0].identity.kind).toBe("pin");
  });
  test("filter changes preserve a reader's selection even when membership changes", () => {
    const next = reduce(createSlotDeck("desk", a), { type: "filter", slotId: "sessions-source", filter: { scope: "asks" } });
    expect(slotSelection(next, "sessions-detail")).toEqual(a);
  });
  test("deep links use an existing follower; comparison is a separate pin", () => {
    const next = reduce(createSlotDeck("desk", a), { type: "open", selection: b, compare: a });
    expect(next.slots).toHaveLength(3); expect(slotSelection(next, "sessions-detail")).toEqual(b);
    expect(slotSelection(next, "route-compare")).toEqual(a);
    expect(reduce(next, { type: "open", selection: b }).slots).toHaveLength(2);
  });
  test("deep links into a pins-only layout append a fixed session", () => {
    const deck = { ...createSlotDeck(), slots: [] };
    expect(slotSelection(reduce(deck, { type: "open", selection: a }), "route-session")).toEqual(a);
  });
  test("move is explicit and resize reuses lane width bounds", () => {
    const deck = reduce(createSlotDeck(), { type: "move", slotId: "sessions-detail", direction: -1 });
    expect(orderedSlots(deck)[0].id).toBe("sessions-detail");
    expect(slotWidth({ ...deck.slots[0], width: 100 })).toBe(240);
    expect(slotWidth({ ...deck.slots[0], width: "md" })).toBe(512);
    expect(slotWidth({ ...deck.slots[0], width: "flex" })).toBe("flex");
  });
  test("malformed storage and duplicate ids recover to Desk", () => {
    expect(deserializeSlotDeck({ version: 2, slots: [{ id: "x" }] })).toEqual(createSlotDeck());
    const deck = createSlotDeck(); deck.slots.push(deck.slots[0]);
    expect(deserializeSlotDeck(deck)).toEqual(createSlotDeck());
  });
});

test("v1 lane import is lossless and retains zones, widths, profiles and orphan definitions", () => {
  const legacy: LaneDeckState = { ...createDefaultLaneDeck("hud.tail"), updatedAt: 123, showAutoLanes: false,
    laneWidths: { a: 500, orphan: "lg" },
    laneDefs: [{ id: "a", kind: "session", title: "A", sessionId: "s" }, { id: "p", kind: "project", title: "Repo", projectPath: "/repo" },
      { id: "h", kind: "harness", title: "Codex", harness: "codex" }, { id: "q", kind: "attention", title: "Asks" }, { id: "orphan", kind: "session", title: "Orphan", sessionId: "old" }],
    slots: [{ id: "a-slot", laneDefId: "a", position: 3, zone: "pinned_left" }, { id: "p-slot", laneDefId: "p", position: 1, zone: "main", width: "sm" },
      { id: "h-slot", laneDefId: "h", position: 2, zone: "main" }, { id: "q-slot", laneDefId: "q", position: 4, zone: "pinned_right" }],
  };
  const original = JSON.stringify(legacy); const next = migrateLaneDeck(legacy);
  expect(JSON.stringify(legacy)).toBe(original); expect(next.legacyLaneDeck).toEqual(legacy);
  expect(next.slots[0]).toMatchObject({ primitive: "lane", width: 500, position: 3, zone: "pinned_left" });
  expect(slotSelection(next, "a-slot")).toEqual({ sessionRef: "s" });
  expect(next.slots[1].identity).toEqual({ kind: "pin", target: { kind: "project", project: "/repo" } });
  expect(next.slots[2].identity).toEqual({ kind: "pin", target: { kind: "harness", harness: "codex" } });
  expect(next.slots[3].identity).toEqual({ kind: "filter", filter: { scope: "asks" } });
  expect(deserializeSlotDeck(JSON.parse(JSON.stringify(next)))).toEqual(next);
});
test("configuring primitives reuses identities; invalid follow cycles are rejected", () => {
  const deck = createSlotDeck("desk", a);
  const lane = reduce(deck, { type: "configure", slotId: "sessions-source", patch: { primitive: "lane" } });
  expect(lane.slots[0].primitive).toBe("lane"); expect(slotSelection(lane, "sessions-detail")).toEqual(a);
  expect(reduce(lane, { type: "configure", slotId: "sessions-source", patch: { identity: { kind: "follow", slotId: "sessions-detail" } } })).toBe(lane);
});
test("deep links do not attempt to select into a fixed pin, including follow chains", () => {
  const deck = createSlotDeck("mix", a); deck.slots[1].identity = { kind: "follow", slotId: "sessions-pin" };
  const next = reduce(deck, { type: "open", selection: b });
  expect(slotSelection(next, "sessions-detail")).toEqual(a); expect(slotSelection(next, "route-session")).toEqual(b);
});
test("arbitrary slots can be added without replacing a saved layout", () => {
  const deck = createSlotDeck(); const slot = { ...deck.slots[0], id: "extra", position: 2 };
  const next = reduce(deck, { type: "add", slot }); expect(next.slots).toHaveLength(3);
  expect(reduce(next, { type: "add", slot })).toBe(next);
});
