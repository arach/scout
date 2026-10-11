import { parseSessionRouteRef, sessionHarnessMatches } from "../../../shared/session-route-ref.ts";
/**
 * Operate: the existing Scout shell, then independently selected slots.
 * Inherit Scout tokens and Agent Lanes/Observe blocks; no new visual language.
 * The board selects; following readers swap; torn-out readers hold their place.
 * Desk opens with a list, thread and facts. Other presets change slots, not data.
 * Layout widths and detail density intentionally await the separate paint pass.
 */
import { useEffect, useReducer, useState } from "react";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { Button } from "../../components/ui/button.tsx";
import { api } from "../../lib/api.ts";
import { isBrokerDataEvent, useBrokerEventsRefresh } from "../../lib/sse.ts";
import type { Flight, Route } from "../../lib/types.ts";
import { AgentLaneCard } from "../ops/AgentLaneCard.tsx";
import { agentLaneToCardModel } from "../ops/agent-lane-card-model.ts";
import { loadLaneDeck } from "../ops/lane-deck.ts";
import { SessionObserve } from "./SessionObserve.tsx";
import { SessionSlot } from "./SessionSlot.tsx";
import { resolveFlightSessionId, uniqueFlightSessions } from "./flight-observe.ts";
import { matchesSessionFilter, type SessionBoardRow } from "./session-board-model.ts";
import { useSessionBoard } from "./use-session-board.ts";
import {
  SLOT_PRESETS, migrateLaneDeck, orderedSlots, readSlotDeck, saveSlotDeck, slotDeckReducer, slotFilter, slotSelection, slotWidth,
  type SessionDensity, type SessionFilter, type SessionSelection, type SessionSlot as Slot,
} from "./slot-deck.ts";
import "./sessions-slots.css";

type SessionsRoute = Extract<Route, { view: "sessions" }>;
const FILTERS: { value: SessionFilter["scope"]; label: string }[] = [
  { value: "all", label: "All" }, { value: "working", label: "Working" }, { value: "asks", label: "Asks" },
  { value: "from_agents", label: "From agents" }, { value: "working_asks", label: "Working + asks" },
];
function sessionMatches(row: SessionBoardRow, selection: SessionSelection | null): boolean {
  const parsed = parseSessionRouteRef(selection?.sessionRef);
  return !!selection && !!parsed && row.sessionId === parsed.refId && sessionHarnessMatches(parsed.harness, row.harness)
    && (!selection.machineId || selection.machineId === row.machine);
}
function identityLabel(slot: Slot, ordered: Slot[]): string {
  const identity = slot.identity;
  if (identity.kind === "filter") return `filter · ${FILTERS.find((f) => f.value === identity.filter.scope)?.label ?? "All"}`;
  if (identity.kind === "follow") {
    const index = ordered.findIndex((s) => s.id === identity.slotId);
    return index >= 0 ? `follows slot ${index + 1}` : "follows a closed slot";
  }
  return identity.target.kind === "session" ? `pin · ${identity.target.session?.sessionRef ?? "choose a session"}`
    : `pin · ${identity.target.kind === "project" ? identity.target.project : identity.target.harness}`;
}
function SessionBoard({ slot, rows, selected, onSelect, onFilter, now }: {
  slot: Slot; rows: SessionBoardRow[]; selected: SessionSelection | null; now: number;
  onSelect: (row: SessionBoardRow) => void; onFilter: (filter: SessionFilter) => void;
}) {
  const filter = slotFilter(slot);
  const members = rows.filter((row) => matchesSessionFilter(row, filter)
    && (slot.identity.kind === "follow" || slot.identity.kind === "pin" && slot.identity.target.kind === "session" ? sessionMatches(row, selected) : true));
  const projects = [...new Set(rows.map((r) => r.project).filter((p): p is string => !!p))].sort();
  const machines = new Map(rows.map((r) => [r.machine ?? "local", r.machineName ?? r.machine ?? "This machine"]));
  return <div className={`s-session-board s-session-board--${slot.density === "cards" ? "cards" : "list"}`}>
    {slot.identity.kind === "filter" && <div className="s-session-filters">
      <label>Show<select value={filter.scope} onChange={(e) => onFilter({ ...filter, scope: e.target.value as SessionFilter["scope"] })}>
        {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select></label>
      <label>Project<select value={filter.project ?? ""} onChange={(e) => onFilter({ ...filter, project: e.target.value || undefined })}>
        <option value="">All projects</option>{projects.map((p) => <option key={p} value={p}>{p.split("/").at(-1)}</option>)}
      </select></label>
      <label>Machine<select value={filter.machine ?? ""} onChange={(e) => onFilter({ ...filter, machine: e.target.value || undefined })}>
        <option value="">All machines</option>{[...machines].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
    </div>}
    <div className="s-session-board-members">
      {members.length === 0 && <p className="s-session-empty">No sessions match this slot. Change its filter or wait for a session to appear.</p>}
      {members.map((row) => slot.primitive === "lane" && row.lane ? <div className="s-session-lane" key={row.key} data-selected={sessionMatches(row, selected)}>
        <AgentLaneCard model={agentLaneToCardModel(row.lane, { isLive: row.working, nowMs: now })}
          avatar={<HarnessMark harness={row.harness ?? "unknown"} size={24} />} onOpen={() => onSelect(row)}
          trace={row.lane.observe && <SessionObserve data={row.lane.observe} variant="lane" traceLimit={12} showRail={false} laneCollapseTechnicalEvents />} />
        <p className="s-session-origin">{row.origin.label}{row.asks ? " · Needs input" : ""}</p>
      </div> : <button type="button" key={row.key} className="s-session-member" aria-pressed={sessionMatches(row, selected)} onClick={() => onSelect(row)}>
        <span className="s-session-member-top"><HarnessMark harness={row.harness ?? "unknown"} size={14} /><strong>{row.title}</strong>
          <span className="s-session-state" data-state={row.asks ? "asks" : row.working ? "working" : "idle"}>{row.asks ? "Ask" : row.working ? "Working" : ""}</span></span>
        <span className="s-session-member-meta">{row.project?.split("/").at(-1) ?? "No project"} · {row.origin.label}</span>
        <small>{row.machineName ?? row.machine ?? "This machine"}{row.model ? ` · ${row.model}` : ""}</small>
      </button>)}
    </div>
  </div>;
}

function useFlightSessions(flightId: string | undefined) {
  const [state, setState] = useState<{ id?: string; flight: Flight | null; error: string | null; loading: boolean }>({ flight: null, error: null, loading: false });
  const [revision, setRevision] = useState(0);
  useBrokerEventsRefresh((event) => !!flightId && isBrokerDataEvent(event), () => setRevision((r) => r + 1), 1_000);
  useEffect(() => {
    if (!flightId) return;
    let cancelled = false;
    setState((s) => ({ id: flightId, flight: s.id === flightId ? s.flight : null, loading: true, error: null }));
    void api<Flight[]>(`/api/flights?active=false&flightId=${encodeURIComponent(flightId)}`)
      .then((flights) => { if (!cancelled) setState({ id: flightId, flight: flights[0] ?? null, loading: false, error: flights.length ? null : "Flight record unavailable. A concrete session link can still be opened." }); })
      .catch((cause) => { if (!cancelled) setState({ id: flightId, flight: null, loading: false, error: String(cause) }); });
    return () => { cancelled = true; };
  }, [flightId, revision]);
  return state.id === flightId ? state : { flight: null, loading: !!flightId, error: null };
}

export function SessionsSlotsScreen({ route, navigate }: { route: SessionsRoute; navigate: (r: Route) => void }) {
  const board = useSessionBoard();
  const [deck, dispatch] = useReducer(slotDeckReducer, undefined, readSlotDeck);
  const [saveError, setSaveError] = useState<string | null>(null);
  const flight = useFlightSessions(route.flightId);
  const trace = flight.flight?.sessions ?? [];
  const sessions = uniqueFlightSessions(trace);
  const requested = route.flightId ? resolveFlightSessionId(trace, route.sessionId) : route.sessionId;
  useEffect(() => { setSaveError(saveSlotDeck(deck)); }, [deck]);
  const routeKey = JSON.stringify([requested, route.machineId, route.compareSessionId]);
  const [appliedRoute, setAppliedRoute] = useState<string | null>(null);
  if (routeKey !== appliedRoute) {
    setAppliedRoute(routeKey);
    if (requested) dispatch({ type: "open", selection: { sessionRef: requested, ...(route.machineId ? { machineId: route.machineId } : {}) },
      ...(route.compareSessionId ? { compare: { sessionRef: route.compareSessionId, ...(route.machineId ? { machineId: route.machineId } : {}) } } : {}) });
  }
  useEffect(() => {
    if (requested || board.loading) return;
    for (const slot of deck.slots) {
      if (slot.identity.kind !== "filter" || slotSelection(deck, slot.id)) continue;
      const first = board.rows.find((row) => matchesSessionFilter(row, slot.identity.kind === "filter" ? slot.identity.filter : { scope: "all" }));
      if (first) dispatch({ type: "select", slotId: slot.id, selection: first.selection });
    }
  }, [board.loading, board.rows, deck, requested]);
  const ordered = orderedSlots(deck);
  const current = ordered.map((slot) => slotSelection(deck, slot.id)).find((s) => s !== null) ?? undefined;
  return <section className="s-sessions-slots" aria-label="Sessions">
    <header className="s-slots-toolbar">
      <h1>Sessions</h1>
      <div className="s-session-actions" role="group" aria-label="Session layout presets">
        {SLOT_PRESETS.map((preset) => <Button key={preset.id} size="sm" variant="outline" aria-pressed={deck.preset === preset.id}
          onClick={() => dispatch({ type: "preset", preset: preset.id, selection: current })}>{preset.label}</Button>)}
      </div>
      <label className="s-slots-add"><select aria-label="Add slot" value="" onChange={(e) => {
        const primitive = e.target.value as "board" | "lane" | "session";
        if (!primitive) return;
        const source = ordered.find((slot) => slot.primitive === "board" || slot.primitive === "lane");
        dispatch({ type: "add", slot: { id: `slot-${crypto.randomUUID()}`, primitive, density: primitive === "session" ? "sheet" : "list",
          identity: primitive === "session" ? source ? { kind: "follow", slotId: source.id } : { kind: "pin", target: { kind: "session", session: current ?? null } }
            : { kind: "filter", filter: { scope: "all" } }, zone: "main", position: Math.max(0, ...ordered.map((s) => s.position)) + 1, width: primitive === "session" ? "flex" : 330 } });
      }}><option value="">Add slot…</option><option value="board">Board</option><option value="lane">Lane</option><option value="session">Session</option></select></label>
      <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "load", deck: migrateLaneDeck(loadLaneDeck("web.ops")) })}>Import saved Lanes</Button>
      <Button size="sm" variant="ghost" onClick={() => void board.refresh()}>Refresh</Button>
    </header>
    {(board.error || board.requests.error || saveError) && <p className="s-session-notice" role="status">{board.error || board.requests.error || saveError}</p>}
    {board.loading && <p className="s-session-notice" role="status">Loading sessions…</p>}
    {route.flightId && <div className="s-slots-flight">
      <span>Flight {route.flightId} · {flight.flight?.state ?? (flight.loading ? "Loading" : "Unavailable")}</span>
      {sessions.length > 0 && <label>Session<select value={requested ?? ""} onChange={(e) => navigate({ ...route, sessionId: e.target.value })}>
        {sessions.map((s) => <option key={s.sessionId} value={s.sessionId}>{s.harness} · {s.sessionId}</option>)}
      </select></label>}
      {sessions.length > 1 && <label>Compare<select value={route.compareSessionId ?? ""} onChange={(e) => navigate({ ...route, compareSessionId: e.target.value || undefined })}>
        <option value="">No comparison</option>{sessions.filter((s) => s.sessionId !== requested).map((s) => <option key={s.sessionId} value={s.sessionId}>{s.sessionId}</option>)}
      </select></label>}
      {flight.error && <span role="status">{flight.error}</span>}
      {!flight.loading && !flight.error && !sessions.length && <span>Waiting for the flight to report a session.</span>}
    </div>}
    <div className={`s-slot-list s-slot-list--${deck.preset}`}>
      {ordered.length === 0 && <p className="s-session-empty">No slots in this layout. Choose a preset to start.</p>}
      {ordered.map((slot, index) => {
        const selected = slotSelection(deck, slot.id);
        const row = board.rows.find((r) => sessionMatches(r, selected));
        return <section className="s-primitive-slot" key={slot.id} data-primitive={slot.primitive} data-density={slot.density}
          style={{ flex: slotWidth(slot) === "flex" ? "1 0 420px" : `0 0 ${slotWidth(slot)}px` }} aria-label={`Slot ${index + 1}: ${slot.primitive}`}>
          <header className="s-slot-head">
            <strong className="s-slot-prim"><span className="s-slot-num">{index + 1}</span>{slot.primitive}{slot.density ? ` · ${slot.density}` : ""}</strong><span title={identityLabel(slot, ordered)}>{identityLabel(slot, ordered)}</span>
            <details className="s-slot-options"><summary aria-label={`Options for slot ${index + 1}`}>Slot</summary><div>
              <label>Primitive<select value={slot.primitive} onChange={(e) => dispatch({ type: "configure", slotId: slot.id, patch: {
                primitive: e.target.value as Slot["primitive"], density: e.target.value === "session" ? "sheet" : "list", inspector: false } })}>
                <option value="board">Board</option><option value="lane">Lane</option><option value="session">Session</option>
              </select></label>
              <label>Density<select value={slot.density ?? "list"} onChange={(e) => dispatch({ type: "configure", slotId: slot.id, patch: { density: e.target.value as Slot["density"] } })}>
                {(slot.primitive === "session" ? ["desk", "reading", "sheet"] : ["list", "cards"]).map((d) => <option key={d} value={d}>{d}</option>)}
              </select></label>
              <label>Identity<select value={slot.identity.kind === "pin" ? `pin-${slot.identity.target.kind}` : slot.identity.kind}
                onChange={(e) => {
                  const source = ordered.find((s) => s.id !== slot.id && s.identity.kind !== "follow");
                  const project = row?.project ?? board.rows.find((r) => r.project)?.project;
                  const harness = row?.harness ?? board.rows.find((r) => r.harness)?.harness;
                  const identity = e.target.value === "filter" ? { kind: "filter" as const, filter: { scope: "all" as const } }
                    : e.target.value === "follow" && source ? { kind: "follow" as const, slotId: source.id }
                    : e.target.value === "pin-project" && project ? { kind: "pin" as const, target: { kind: "project" as const, project } }
                    : e.target.value === "pin-harness" && harness ? { kind: "pin" as const, target: { kind: "harness" as const, harness } }
                    : { kind: "pin" as const, target: { kind: "session" as const, session: selected ?? current ?? null } };
                  dispatch({ type: "configure", slotId: slot.id, patch: { identity } });
                }}>
                <option value="filter">Filter</option><option value="follow" disabled={ordered.length < 2}>Follow</option><option value="pin-session">Pin session</option>
                <option value="pin-project" disabled={!board.rows.some((r) => r.project)}>Pin project</option><option value="pin-harness" disabled={!board.rows.some((r) => r.harness)}>Pin harness</option>
              </select></label>
              {slot.identity.kind === "follow" && <label>Source<select value={slot.identity.slotId} onChange={(e) => dispatch({ type: "configure", slotId: slot.id, patch: { identity: { kind: "follow", slotId: e.target.value } } })}>
                {ordered.filter((s) => s.id !== slot.id && s.identity.kind !== "follow").map((s, i) => <option key={s.id} value={s.id}>{i + 1} · {s.primitive} · {s.id}</option>)}
              </select></label>}
              <label>Width<select value={slot.width} onChange={(e) => dispatch({ type: "resize", slotId: slot.id, width: e.target.value === "flex" || ["sm", "md", "lg"].includes(e.target.value) ? e.target.value as Slot["width"] : Number(e.target.value) })}>
                <option value="flex">Flexible</option>{[260, 330, 440, 512, 620].map((w) => <option key={w} value={w}>{w}px</option>)}
                {slot.width !== "flex" && ![260, 330, 440, 512, 620].includes(Number(slot.width)) && <option value={slot.width}>{slot.width}</option>}
              </select></label>
              <Button size="xs" variant="outline" disabled={index === 0} onClick={() => dispatch({ type: "move", slotId: slot.id, direction: -1 })}>Move left</Button>
              <Button size="xs" variant="outline" disabled={index === ordered.length - 1} onClick={() => dispatch({ type: "move", slotId: slot.id, direction: 1 })}>Move right</Button>
              <Button size="xs" variant="outline" onClick={() => dispatch({ type: "remove", slotId: slot.id })}>Close slot</Button>
            </div></details>
            {slot.identity.kind === "follow" && <Button size="xs" variant="outline" disabled={!selected} onClick={() => dispatch({ type: "tear-out", slotId: slot.id, newId: `pin-${crypto.randomUUID()}` })}>Tear out</Button>}
          </header>
          <div className="s-slot-body">
            {slot.primitive === "session" && slot.identity.kind !== "follow" && !(slot.identity.kind === "pin" && slot.identity.target.kind === "session") && <label className="s-session-filters">Session in this scope<select value={row?.key ?? ""} onChange={(e) => {
              const member = board.rows.find((r) => r.key === e.target.value); if (member) dispatch({ type: "select", slotId: slot.id, selection: member.selection });
            }}><option value="">Choose session</option>{board.rows.filter((r) => matchesSessionFilter(r, slotFilter(slot))).map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}</select></label>}
            {slot.primitive === "board" || slot.primitive === "lane" ? <SessionBoard slot={slot} rows={board.rows} selected={selected} now={board.now}
              onFilter={(filter) => dispatch({ type: "filter", slotId: slot.id, filter })}
              onSelect={(member) => {
                dispatch({ type: "select", slotId: slot.id, selection: member.selection });
                // Selection, not invocation: opening a card never wakes or reorders it.
                if (!deck.slots.some((s) => s.primitive === "session" && s.identity.kind === "follow" && s.identity.slotId === slot.id)) {
                  dispatch({ type: "open", selection: member.selection });
                }
              }} />
              : slot.primitive === "session" ? selected
                ? <SessionSlot key={`${selected.machineId ?? ""}:${selected.sessionRef}`} selection={selected} density={slot.density as SessionDensity} inspector={slot.inspector}
                  row={row} requests={board.requests.state?.items ?? []} navigate={navigate} localNodeId={board.localNodeId} />
                : <div className="s-session-empty"><p>{slot.identity.kind === "follow" ? "Select a session in the source slot." : "Choose a session in the board, then pin it here."}</p>
                  {slot.identity.kind === "pin" && current && <Button size="sm" variant="outline" onClick={() => dispatch({ type: "pin", slotId: slot.id, selection: current })}>Pin selected session</Button>}</div>
              : <p className="s-session-empty">{slot.primitive} slots are reserved, not implemented.</p>}
          </div>
        </section>;
      })}
    </div>
  </section>;
}
