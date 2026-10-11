import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api } from "../../../lib/api.ts";
import { takeWorldCommands } from "../../../lib/world-command.ts";
import type { WorldHandle } from "./engine.ts";

/*
 * Words → the HUD's ":" line. Typed words that aren't a verb (the engine hands
 * them over through onFreeText) and always-on voice (`world.command` UI actions)
 * both go to POST /api/ops/world-command with what the HUD knows; whatever comes
 * back runs through runCommand. A quiet echo says what ran; a low-confidence
 * guess waits for Enter (run) or Esc (drop). While mounted and visible the page
 * holds a presence stream so always-on voice knows the World is open.
 */

type Proposal = { verb: string; commands: string[]; echo: string; confidence: number };
type Result =
  | ({ status: "ok"; engine: string } & Proposal)
  | { status: "confirm"; engine: string; proposal: Proposal }
  | { status: "none"; engine: string; echo: string };
type Echo = { kind: "busy" | "ok" | "none" | "confirm"; line: string; note?: string; proposal?: Proposal };

const ECHO_MS = 3_600, CONFIRM_MS = 12_000;

export function useWorldWords(world: RefObject<WorldHandle | null>, ready: boolean) {
  const [echo, setEcho] = useState<Echo | null>(null);
  const confirmRef = useRef<Proposal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const show = useCallback((next: Echo | null) => {
    clearTimeout(timer.current);
    confirmRef.current = next?.kind === "confirm" ? next.proposal ?? null : null;
    setEcho(next);
    if (next && next.kind !== "busy") timer.current = setTimeout(() => { confirmRef.current = null; setEcho(null); }, next.kind === "confirm" ? CONFIRM_MS : ECHO_MS);
  }, []);

  const run = useCallback((commands: string[], note?: string) => {
    const handle = world.current;
    if (!handle) return;
    for (const line of commands) handle.runCommand(line);
    show({ kind: "ok", line: ":" + commands.join("  ·  :"), note });
  }, [show, world]);

  const resolve = useCallback(async (text: string) => {
    const handle = world.current;
    if (!handle) return;
    const mine = ++seq.current;
    show({ kind: "busy", line: text.toLowerCase(), note: "…" });
    let res: Result;
    try {
      res = await api<Result>("/api/ops/world-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, context: handle.state() }),
      });
    } catch {
      if (mine === seq.current) show({ kind: "none", line: "COULDN'T RESOLVE · " + text.toUpperCase() });
      return;
    }
    if (mine !== seq.current) return; // a newer utterance won
    const engine = res.engine === "fallback" ? "KEYWORDS" : res.engine.toUpperCase();
    if (res.status === "ok") run(res.commands, `${engine} ${Math.round(res.confidence * 100)}`);
    else if (res.status === "confirm") show({ kind: "confirm", line: ":" + res.proposal.commands.join("  ·  :"), note: `${engine} ${Math.round(res.proposal.confidence * 100)}`, proposal: res.proposal });
    else show({ kind: "none", line: res.echo });
  }, [run, show, world]);

  // Enter runs a pending guess, Esc drops it. Registered at mount, so it runs before the engine's own window listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const proposal = confirmRef.current;
      if (!proposal || (e.key !== "Enter" && e.key !== "Escape")) return;
      const a = document.activeElement;
      if (a && a.matches("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === "Enter") run(proposal.commands, "CONFIRMED");
      else show(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); clearTimeout(timer.current); };
  }, [run, show]);

  // world.command actions (voice, Scoutbot): literal lines run as given, words resolve here
  useEffect(() => {
    if (!ready) return;
    return takeWorldCommands((action) => {
      // ⌥ held on a pointed session (or a frozen frame): the words are for it, not for the HUD's command line
      const handle = world.current;
      if (action.text && handle?.psListening?.()) { handle.psHeard?.(action.text); return; }
      if (action.commands?.length) run(action.commands, "VOICE");
      else if (action.text) void resolve(action.text);
    });
  }, [ready, resolve, run, world]);

  // presence: always-on voice sends HUD moves here only while a World page is open and visible
  useEffect(() => {
    if (!ready || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    const sync = () => {
      const visible = document.visibilityState === "visible";
      if (visible && !source) source = new EventSource("/api/voice/ambient/actions?presence=world");
      else if (!visible && source) { source.close(); source = null; }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { document.removeEventListener("visibilitychange", sync); source?.close(); };
  }, [ready]);

  // stable, so the engine can hold it from mount
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const onFreeText = useCallback((text: string) => { void resolveRef.current(text); }, []);
  return { onFreeText, echo };
}

const FONT_SIZE = 8.5;
/** The quiet line above the status bar: what ran, or the guess waiting for Enter. */
export function WorldEcho({ echo }: { echo: Echo | null }) {
  if (!echo) return null;
  const confirm = echo.kind === "confirm";
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute", left: 16, bottom: 34, zIndex: 25, maxWidth: "min(70%, 720px)",
        display: "flex", gap: 10, alignItems: "baseline", padding: "3px 8px",
        font: `300 ${FONT_SIZE}px/1.5 var(--wm-font), ui-monospace, monospace`, letterSpacing: "0.1em",
        color: echo.kind === "none" ? "var(--dim)" : "var(--fg)",
        background: "rgba(5,7,6,0.88)", border: `1px solid ${confirm ? "var(--accent-dim)" : "var(--line)"}`,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none",
      }}
    >
      {confirm && <span style={{ color: "var(--accent)" }}>DID YOU MEAN</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{echo.line}</span>
      {echo.note && <span style={{ color: "var(--faint)" }}>{echo.note}</span>}
      {confirm && <span style={{ color: "var(--faint)" }}>↵ RUN · ESC DROP</span>}
    </div>
  );
}
