import {
  compareLaneZones,
  resolveLaneWidthPx,
  type AgentLaneWidthTier,
  type LaneDeckState,
  type LaneDeckZone,
} from "../ops/lane-deck.ts";

export type SlotPrimitive = "board" | "lane" | "session" | "chat" | "terminal";
export type SessionDensity = "desk" | "reading" | "sheet";
export type SessionSelection = { sessionRef: string; machineId?: string };
export type SessionFilter = {
  scope: "all" | "working" | "asks" | "from_agents" | "working_asks";
  project?: string;
  machine?: string;
  harness?: string;
};
export type SlotPin =
  | { kind: "session"; session: SessionSelection | null }
  | { kind: "project"; project: string }
  | { kind: "harness"; harness: string };
export type SlotIdentity =
  | { kind: "filter"; filter: SessionFilter }
  | { kind: "follow"; slotId: string }
  | { kind: "pin"; target: SlotPin };
export type SessionSlot = {
  id: string;
  primitive: SlotPrimitive;
  identity: SlotIdentity;
  density?: "cards" | "list" | SessionDensity;
  inspector?: boolean;
  zone: LaneDeckZone;
  position: number;
  width: number | AgentLaneWidthTier | "flex";
  title?: string;
};
export type SlotPresetId = "desk" | "focus" | "board" | "mix";
export type SlotDeck = {
  version: 2;
  profileId: string;
  preset: SlotPresetId;
  slots: SessionSlot[];
  selections: Record<string, SessionSelection | undefined>;
  /** Kept verbatim on explicit import, including orphan defs, widths and auto-lane policy. */
  legacyLaneDeck?: LaneDeckState;
};
export const SLOT_DECK_KEY = "openscout:slot-deck:v2:web.sessions";
export const SLOT_PRESETS = [
  { id: "desk", label: "Desk" }, { id: "focus", label: "Focus" },
  { id: "board", label: "Board + sheet" }, { id: "mix", label: "Mix" },
] as const;

/** Parallel storage deliberately leaves every v1 Lanes/Ops profile untouched. */
export function createSlotDeck(preset: SlotPresetId = "desk", selected?: SessionSelection): SlotDeck {
  const source: SessionSlot = {
    id: "sessions-source", primitive: preset === "mix" ? "lane" : "board",
    density: preset === "board" ? "cards" : "list",
    identity: { kind: "filter", filter: { scope: preset === "mix" ? "working_asks" : "all" } },
    zone: "main", position: 0, width: preset === "board" ? "flex" : preset === "focus" ? 260 : 330,
  };
  const detail: SessionSlot = {
    id: "sessions-detail", primitive: "session", identity: { kind: "follow", slotId: source.id },
    density: preset === "focus" ? "reading" : preset === "desk" ? "desk" : "sheet",
    inspector: preset === "desk", zone: "main", position: 1, width: preset === "board" ? 620 : "flex",
  };
  return {
    version: 2, profileId: "web.sessions", preset, slots: [source, detail, ...(preset === "mix" ? [{
      ...detail, id: "sessions-pin", identity: { kind: "pin", target: { kind: "session", session: selected ?? null } } as SlotIdentity,
      position: 2, width: 440,
    }] : [])], selections: selected ? { [source.id]: selected } : {},
  };
}

export function orderedSlots(deck: SlotDeck): SessionSlot[] {
  return [...deck.slots].sort((a, b) => compareLaneZones(a.zone, b.zone) || a.position - b.position);
}
export function slotWidth(slot: SessionSlot): number | "flex" {
  return slot.width === "flex" ? "flex" : resolveLaneWidthPx(slot.width, "md");
}
export function slotSelection(deck: SlotDeck, slotId: string, visited = new Set<string>()): SessionSelection | null {
  if (visited.has(slotId)) return null;
  visited.add(slotId);
  const slot = deck.slots.find((item) => item.id === slotId);
  if (!slot) return null;
  if (slot.identity.kind === "follow") return slotSelection(deck, slot.identity.slotId, visited);
  if (slot.identity.kind === "pin" && slot.identity.target.kind === "session") return slot.identity.target.session;
  return deck.selections[slotId] ?? null;
}
export function slotFilter(slot: SessionSlot): SessionFilter {
  if (slot.identity.kind === "filter") return slot.identity.filter;
  if (slot.identity.kind === "pin" && slot.identity.target.kind === "project") return { scope: "all", project: slot.identity.target.project };
  if (slot.identity.kind === "pin" && slot.identity.target.kind === "harness") return { scope: "all", harness: slot.identity.target.harness };
  return { scope: "all" };
}

export type SlotAction =
  | { type: "add"; slot: SessionSlot }
  | { type: "configure"; slotId: string; patch: Partial<Pick<SessionSlot, "primitive" | "density" | "identity" | "inspector">> }
  | { type: "select"; slotId: string; selection: SessionSelection }
  | { type: "filter"; slotId: string; filter: SessionFilter }
  | { type: "tear-out"; slotId: string; newId: string }
  | { type: "pin"; slotId: string; selection: SessionSelection }
  | { type: "remove"; slotId: string }
  | { type: "move"; slotId: string; direction: -1 | 1 }
  | { type: "resize"; slotId: string; width: SessionSlot["width"] }
  | { type: "preset"; preset: SlotPresetId; selection?: SessionSelection }
  | { type: "load"; deck: SlotDeck }
  | { type: "open"; selection: SessionSelection; compare?: SessionSelection };

export function slotDeckReducer(deck: SlotDeck, action: SlotAction): SlotDeck {
  const slot = "slotId" in action ? deck.slots.find((s) => s.id === action.slotId) : undefined;
  switch (action.type) {
    case "add":
      return deck.slots.some((s) => s.id === action.slot.id) ? deck : { ...deck, slots: [...deck.slots, action.slot] };
    case "configure": {
      if (!slot) return deck;
      const next = { ...deck, slots: deck.slots.map((s) => s.id === slot.id ? { ...s, ...action.patch } : s) };
      // A newly chosen follow source must exist and must not make a cycle.
      let cursor = next.slots.find((s) => s.id === slot.id);
      const seen = new Set<string>();
      while (cursor?.identity.kind === "follow") {
        if (seen.has(cursor.id)) return deck;
        seen.add(cursor.id);
        const sourceId = cursor.identity.slotId;
        cursor = next.slots.find((s) => s.id === sourceId);
        if (!cursor) return deck;
      }
      return next;
    }
    case "select":
      if (!slot || slot.identity.kind === "follow" || (slot.identity.kind === "pin" && slot.identity.target.kind === "session")) return deck;
      return { ...deck, selections: { ...deck.selections, [slot.id]: action.selection } };
    case "filter":
      if (!slot || slot.identity.kind !== "filter") return deck;
      return { ...deck, slots: deck.slots.map((s) => s.id === slot.id ? { ...s, identity: { kind: "filter", filter: action.filter } } : s) };
    case "tear-out": {
      if (!slot || slot.identity.kind !== "follow" || deck.slots.some((s) => s.id === action.newId)) return deck;
      const selection = slotSelection(deck, slot.id);
      if (!selection) return deck;
      // Append a frozen copy. Neither the source selection nor any existing order changes.
      return { ...deck, slots: [...deck.slots, {
        ...slot, id: action.newId, width: 440, inspector: false, zone: "pinned_right",
        position: deck.slots.length, identity: { kind: "pin", target: { kind: "session", session: { ...selection } } },
      }] };
    }
    case "pin":
      if (!slot) return deck;
      return { ...deck, slots: deck.slots.map((s) => s.id === slot.id ? { ...s, identity: { kind: "pin", target: { kind: "session", session: action.selection } } } : s) };
    case "remove": {
      if (!slot) return deck;
      const selections = { ...deck.selections }; delete selections[slot.id];
      // Freeze dependent followers before removing their source; never silently retarget them.
      return { ...deck, selections, slots: deck.slots.filter((s) => s.id !== slot.id).map((s) =>
        s.identity.kind === "follow" && s.identity.slotId === slot.id
          ? { ...s, identity: { kind: "pin", target: { kind: "session", session: slotSelection(deck, s.id) } } } : s) };
    }
    case "resize":
      return { ...deck, slots: deck.slots.map((s) => s.id === action.slotId ? { ...s, width: action.width } : s) };
    case "move": {
      if (!slot) return deck;
      const sorted = orderedSlots(deck); const index = sorted.findIndex((s) => s.id === slot.id);
      const other = sorted[index + action.direction]; if (!other) return deck;
      return { ...deck, slots: deck.slots.map((s) => s.id === slot.id ? { ...s, zone: other.zone, position: other.position }
        : s.id === other.id ? { ...s, zone: slot.zone, position: slot.position } : s) };
    }
    case "preset": return createSlotDeck(action.preset, action.selection);
    case "load": return action.deck;
    case "open": {
      // Keep fixed pins intact; deep links may change a following reader's source selection.
      const upsert = (current: SlotDeck, id: string, selection: SessionSelection): SlotDeck => ({ ...current, slots: [
        ...current.slots.filter((s) => s.id !== id),
        { id, primitive: "session", density: "desk", inspector: false, zone: "pinned_right", position: id === "route-session" ? 0 : 1,
          width: "flex", identity: { kind: "pin", target: { kind: "session", session: selection } } },
      ] });
      // A deep link occupies the following detail location, rather than opening an empty duplicate reader.
      const base = { ...deck, slots: deck.slots.filter((s) => s.id !== "route-compare") };
      const selectableSource = (id: string): string | null => {
        const seen = new Set<string>();
        let source = base.slots.find((s) => s.id === id);
        while (source?.identity.kind === "follow") {
          if (seen.has(source.id)) return null;
          seen.add(source.id);
          const sourceId = source.identity.slotId;
          source = base.slots.find((s) => s.id === sourceId);
        }
        return source && (source.identity.kind === "filter" || source.identity.target.kind !== "session") ? source.id : null;
      };
      const source = base.slots.filter((s) => s.primitive === "session" && s.identity.kind === "follow")
        .map((s) => selectableSource(s.id)).find((id) => id !== null);
      const opened = source
        ? { ...base, selections: { ...base.selections, [source]: action.selection } }
        : upsert(base, "route-session", action.selection);
      return action.compare ? upsert(opened, "route-compare", action.compare) : opened;
    }
  }
}

/** Explicit, lossless import; existing v1 readers and their localStorage keys are never rewritten. */
export function migrateLaneDeck(legacy: LaneDeckState): SlotDeck {
  const defaults = createSlotDeck();
  return { ...defaults, slots: legacy.slots.map((slot): SessionSlot => {
    const def = legacy.laneDefs.find((entry) => entry.id === slot.laneDefId);
    const identity: SlotIdentity = def?.kind === "session" ? { kind: "pin", target: { kind: "session", session: def.sessionId ? { sessionRef: def.sessionId } : null } }
      : def?.kind === "project" ? { kind: "pin", target: { kind: "project", project: def.projectPath ?? "" } }
      : def?.kind === "harness" ? { kind: "pin", target: { kind: "harness", harness: def.harness ?? "" } }
      : { kind: "filter", filter: { scope: def?.kind === "attention" ? "asks" : "all" } };
    return { id: slot.id, primitive: "lane", identity, zone: slot.zone, position: slot.position,
      width: slot.width ?? legacy.laneWidths[slot.laneDefId] ?? legacy.defaultLaneWidth, title: def?.title };
  }), selections: {}, legacyLaneDeck: legacy };
}

function isSelection(value: unknown): value is SessionSelection {
  if (!value || typeof value !== "object") return false;
  const v = value as SessionSelection;
  return typeof v.sessionRef === "string" && !!v.sessionRef.trim() && (v.machineId === undefined || typeof v.machineId === "string");
}
function isSlot(value: unknown): value is SessionSlot {
  if (!value || typeof value !== "object") return false;
  const v = value as SessionSlot;
  if (!v.id || typeof v.id !== "string" || !["board", "lane", "session", "chat", "terminal"].includes(v.primitive)
    || !["main", "pinned_left", "pinned_right"].includes(v.zone) || !Number.isFinite(v.position)
    || !(v.width === "flex" || ["sm", "md", "lg"].includes(String(v.width)) || typeof v.width === "number" && Number.isFinite(v.width))) return false;
  const id = v.identity;
  if (id?.kind === "filter") return !!id.filter && ["all", "working", "asks", "from_agents", "working_asks"].includes(id.filter.scope)
    && [id.filter.project, id.filter.machine, id.filter.harness].every((x) => x === undefined || typeof x === "string");
  if (id?.kind === "follow") return typeof id.slotId === "string";
  if (id?.kind === "pin") return id.target?.kind === "session" ? id.target.session === null || isSelection(id.target.session)
    : id.target?.kind === "project" ? typeof id.target.project === "string" : id.target?.kind === "harness" && typeof id.target.harness === "string";
  return false;
}
export function deserializeSlotDeck(raw: unknown): SlotDeck {
  if (!raw || typeof raw !== "object") return createSlotDeck();
  const v = raw as SlotDeck;
  if (v.version !== 2 || !Array.isArray(v.slots) || !v.slots.every(isSlot) || new Set(v.slots.map((s) => s.id)).size !== v.slots.length) return createSlotDeck();
  return { ...v, profileId: "web.sessions", preset: SLOT_PRESETS.some((p) => p.id === v.preset) ? v.preset : "desk",
    selections: Object.fromEntries(Object.entries(v.selections ?? {}).filter(([, s]) => isSelection(s))) };
}
export function readSlotDeck(): SlotDeck {
  try { return deserializeSlotDeck(JSON.parse(localStorage.getItem(SLOT_DECK_KEY) ?? "null")); }
  catch { return createSlotDeck(); }
}
export function saveSlotDeck(deck: SlotDeck): string | null {
  try { localStorage.setItem(SLOT_DECK_KEY, JSON.stringify(deck)); return null; }
  catch { return "This layout could not be saved on this browser. It remains available until you leave."; }
}
