import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.ts";
import { mountWorld, type WorldHandle } from "./engine.ts";
import { connectWorldLive, searchWithSource, sourceFromSearch } from "./live.ts";
import { MARKUP } from "./markup.ts";
import { THEMES, isAccent, isTheme, resolveAccent, resolveThemeId, themeBlock, type AccentChoice, type ThemeId } from "./theme.ts";
import { CSS } from "./styles.ts";
import { useWorldWords, WorldEcho } from "./voice.tsx";

/*
 * World · Modale — /ops/week, a telemetry HUD over one real week.
 *
 * Every dot is one tool call from this machine's Claude and Codex transcripts,
 * every arc a broker ask, every thread a session (native or one that took an
 * ask). Pause to slice through the week and unpack what you hit. Data comes
 * from GET /api/ops/world-week (read-only broker + transcripts); files preview
 * and reveal through /api/ops/world-file, the stash persists at /api/ops/world-stash.
 * The engine is imperative (three.js + canvas); this component only mounts it.
 * The HUD keeps its own side columns; the engine's opts.slots seam is unused here.
 * ?source=live (or ?live) follows every machine as it works: a seed from GET
 * /api/ops/world-live, then rows appended as they land (world-live.ts). ?source=otlp
 * shows only what OTLP exporters POST to /api/ops/world-otlp/v1/{traces,logs}.
 * The WEEK · LIVE · OTLP control and `:source` switch in place, keeping camera + rung.
 * `world.current.runCommand(text)` runs a ":" command line verb; useWorldWords
 * turns typed words and always-on voice into those verbs (see voice.tsx).
 */

const FONT = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace';

type Source = "week" | "live" | "otlp";
type Carry = { view?: string; rung?: number; cam?: unknown; follow?: boolean } | null;

export default function WorldWeek({ operatorName }: { operatorName?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [source, setSource] = useState<Source>(() => sourceFromSearch(window.location.search));
  const carry = useRef<Carry>(null);   // camera + rung + view handed across a source switch or a re-seed
  const [state, setState] = useState<"loading" | "failed" | "ready">("loading");
  const [error, setError] = useState("");
  const world = useRef<WorldHandle | null>(null);
  const words = useWorldWords(world, state === "ready");
  // treatment + accent (theme.ts, ; and ' keys, ?theme= / ?accent=): the engine repaints canvas + GL and says so here,
  // this restyles the CSS vars. Never a remount, so the source effect below does not depend on it
  const [themeId, setThemeId] = useState<ThemeId>("scout");
  const [accent, setAccent] = useState<AccentChoice>({ id: "emerald", explicit: false });
  const theme = THEMES[themeId];
  useLayoutEffect(() => {
    const onTheme = (e: Event) => { const id = (e as CustomEvent<string>).detail; if (isTheme(id)) setThemeId(id); };
    const onAccent = (e: Event) => { const d = (e as CustomEvent<AccentChoice>).detail; if (d && isAccent(d.id)) setAccent({ id: d.id, explicit: !!d.explicit }); };
    window.addEventListener("wm-theme", onTheme); window.addEventListener("wm-accent", onAccent);
    const id = resolveThemeId(); setThemeId(id); setAccent(resolveAccent(id));
    return () => { window.removeEventListener("wm-theme", onTheme); window.removeEventListener("wm-accent", onAccent); };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let dispose: WorldHandle | undefined;
    let cancelled = false, close: (() => void) | null = null;
    const keep = (st: ReturnType<WorldHandle["state"]>, follow?: boolean): Carry => ({ view: st.view, rung: st.rung, cam: st.cam, follow });
    const onSource = (name: Source, st: ReturnType<WorldHandle["state"]>) => {
      // live <-> otlp keeps following as it was; out of the week, a live source follows the wall clock again
      carry.current = keep(st, source === "week" ? undefined : st.follow);
      window.history.replaceState(null, "", window.location.pathname + searchWithSource(window.location.search, name));
      setSource(name);
    };
    const mount = (data: unknown) => {
      const restore = dispose ? keep(dispose.state(), dispose.state().follow) : carry.current;
      carry.current = null;
      dispose?.(); el.innerHTML = MARKUP;
      dispose = mountWorld(el, data, FONT, { operator: operatorName, onFreeText: words.onFreeText, source, onSource, restore, live: { reseed: () => connect() } });
      world.current = dispose;
      setState("ready");
    };
    const connect = () => {
      close?.();
      close = connectWorldLive(`/api/ops/world-live?source=${source}`, {
        onSeed: (p) => { if (!cancelled) { setError(""); mount(p); } },
        // a gap or a machine the seed didn't know: take a fresh seed (the camera carries across)
        onDelta: (d) => { if (dispose && dispose.appendLive(d) !== true) connect(); },
        onStatus: (s) => dispose?.liveStatus(s),
        onError: (m) => { if (!cancelled) setError(m); },
      });
    };
    if (source === "week") {
      // ?data=team swaps in the team: real work from each machine, as personas; the HUD's DATA chip flips the param
      const team = new URLSearchParams(window.location.search).get("data") === "team";
      api<unknown>(team ? "/api/ops/world-week?data=team" : "/api/ops/world-week")
        .then((data) => { if (!cancelled) mount(data); })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
          setState("failed");
        });
    } else connect();
    return () => { cancelled = true; close?.(); world.current = null; dispose?.(); el.innerHTML = ""; };
  }, [operatorName, source]);

  return (
    <>
      <style>{CSS}</style>
      <style id="wm-theme-vars">{themeBlock(theme, accent)}</style>
      <div className="wm wm--app wm-themes" data-theme={theme.id} data-accent={accent.id} data-skin={theme.skin || undefined} data-light={theme.light ? "1" : undefined}
        style={{ ["--wm-font" as string]: FONT }}>
        <div ref={root} style={{ height: "100%" }} />
        <WorldEcho echo={words.echo} />
        {state !== "ready" && (
          <div className="empty" role="status">
            <pre>{state === "loading" ? (source === "week" ? "READING THE WEEK…" : `CONNECTING TO THE LIVE WORLD…${error ? "\n\n" + error : ""}`) : `COULDN'T READ THE WEEK\n\n${error}`}</pre>
          </div>
        )}
      </div>
    </>
  );
}
