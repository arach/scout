/* Glass, the whole app: every screen the app has, on a see-through window,
   with no sidebar, top row, rails or status bar. Home is Home, Chat is Chat.
   What the chrome did moves into the black command bar: ":" or ⌘K brings it
   up, and it carries every destination and app command the palette has, plus
   Glass's own (set, reload, quit) and your command files.
   The Mac app hosts it (ScoutGlassWindow.swift); /glass?app in a browser too.
   Files: glass-config.ts · docs/agent/glass.agent.md. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommandOption, HudsonApp } from "@hudsonkit";

import { api } from "../../lib/api.ts";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import { resolveScoutbotAgent } from "../../lib/scoutbot.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { PRIMARY_AREAS, primaryAreaForRoute } from "../../scout/primary-areas.ts";
import {
  BUILTIN_COMMANDS,
  expandTemplate,
  readGlassSettings,
  SET_KEYS,
  type GlassCommand,
  type GlassSettings,
} from "./glass-config.ts";
import { suggest as suggestLine } from "./GlassSurface.tsx";
import { agentNames, CommandBar, findAgent, type Hint } from "./reply-kit.tsx";
import "./glass.css";
import "./glass-app.css";

type GlassHost = { postMessage: (body: unknown) => void };
type GlassWindow = Window & {
  __SCOUT_GLASS__?: unknown;
  webkit?: { messageHandlers?: { scoutGlass?: GlassHost } };
};

function native(): GlassHost | undefined {
  return (window as GlassWindow).webkit?.messageHandlers?.scoutGlass;
}

function useGlassSettings(): GlassSettings {
  const [settings, setSettings] = useState(() => readGlassSettings((window as GlassWindow).__SCOUT_GLASS__));
  useEffect(() => {
    const onConfig = (event: Event) => setSettings(readGlassSettings((event as CustomEvent).detail));
    window.addEventListener("scout-glass-config", onConfig);
    return () => window.removeEventListener("scout-glass-config", onConfig);
  }, []);
  return settings;
}

/** Glass's own verbs here: the ones that are about the window, not a conversation. */
const GLASS_VERBS = BUILTIN_COMMANDS.filter((c) => ["set", "reload", "quit", "help"].includes(c.verb));

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true'], .xterm"));
}

function areaLabel(route: Route): string {
  const id = primaryAreaForRoute(route);
  return PRIMARY_AREAS.find((area) => area.id === id)?.label ?? (id === "requests" ? "Requests" : String(id));
}

type Row = Hint & { run?: () => void | Promise<void> };

export function GlassAppFrame({ app }: { app: HudsonApp }) {
  const { route, agents } = useScout();
  const appCommands: CommandOption[] = app.hooks.useCommands();
  const settings = useGlassSettings();
  const [line, setLine] = useState<string | null>(null);
  const [echo, setEcho] = useState<string | null>(null);
  const lineRef = useRef<HTMLInputElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const echoTimer = useRef(0);

  useEffect(() => {
    document.documentElement.classList.add("glass-page", "glass-app-page");
    return () => document.documentElement.classList.remove("glass-page", "glass-app-page");
  }, []);

  const say = useCallback((text: string, ms = 3200) => {
    setEcho(text);
    window.clearTimeout(echoTimer.current);
    echoTimer.current = window.setTimeout(() => setEcho(null), ms);
  }, []);
  useEffect(() => {
    if (settings.errors.length) say(settings.errors.join("\n"), 8000);
  }, [settings.errors, say]);

  const open = useCallback(() => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setLine("");
    window.setTimeout(() => lineRef.current?.focus(), 0);
  }, []);
  const close = useCallback(() => {
    setLine(null);
    window.setTimeout(() => returnFocus.current?.focus?.(), 0);
  }, []);

  // ":" outside a field, or ⌘K anywhere, summons the bar; it replaces the palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const k = event.key.toLowerCase();
      if (event.metaKey && !event.shiftKey && !event.altKey && k === "k") {
        event.preventDefault();
        event.stopPropagation();
        if (line === null) open(); else close();
        return;
      }
      if (line === null && event.key === ":" && !event.metaKey && !event.ctrlKey && !isEditable(event.target)) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [line, open, close]);

  const names = useMemo(() => agentNames(agents), [agents]);

  /** "here" is the conversation on screen, else Scoutbot. */
  const conversationFor = useCallback(async (to: string): Promise<string | null> => {
    if (to === "here") {
      const here = (route as { conversationId?: string }).conversationId;
      if (here) return here;
    }
    const agent = to === "here" || to === "scoutbot" ? resolveScoutbotAgent(agents) : to.startsWith("@") ? findAgent(agents, to) : null;
    if (agent) return ensureAgentChat(agent);
    return to.startsWith("@") || to === "here" || to === "scoutbot" ? null : to;
  }, [agents, route]);

  const runUserCommand = async (command: GlassCommand, args: string, depth: number) => {
    if (command.run) return runText(`${command.run} ${args}`.trim(), depth + 1);
    const body = expandTemplate(command.say ?? "", { args, selection: String(window.getSelection() ?? ""), conversation: "" });
    if (!body) return say(`:${command.name} has nothing to say`);
    const target = await conversationFor(command.to);
    if (!target) return say(`E94: No conversation for ${command.to}`);
    await api(`/api/chats/${encodeURIComponent(target)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, clientMessageId: crypto.randomUUID() }),
    });
    say(`:${command.name} → ${command.to}`);
  };

  const runText = async (text: string, depth = 0): Promise<void> => {
    if (depth > 4) return say("E132: Command loops back on itself");
    const [verb = "", ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ");
    if (!verb) return;
    if (verb === "go") {
      const hit = rows.find((row) => row.group === "Go" && row.label.toLowerCase().startsWith(arg.toLowerCase()));
      return hit?.run ? void hit.run() : say(`E94: Nowhere called ${arg}`);
    }
    if (verb === "set") {
      const [key = "", value = ""] = arg.split("=");
      const spec = SET_KEYS[key.toLowerCase()];
      const parsed = spec?.parse(value.trim());
      if (!spec || parsed == null) return say(`E518: Unknown option: ${arg}`);
      const host = native();
      if (!host) return say("set writes glass/config.json from the Mac app");
      host.postMessage({ type: "set", key: spec.path, value: parsed });
      return say(`${key}=${value}`);
    }
    if (verb === "reload") { native()?.postMessage({ type: "reload" }); return say("reloaded"); }
    if (verb === "quit" || verb === "q") {
      const host = native();
      if (!host) return say("quit needs the Mac app");
      host.postMessage({ type: "quit" });
      return;
    }
    if (verb === "help" || verb === "h") {
      return say([
        ": or ⌘K  this bar · type to find any place or command",
        ...GLASS_VERBS.map((c) => `:${c.verb.padEnd(7)} ${c.hint}`),
        ...settings.commands.map((c) => `:${c.name.padEnd(7)} ${c.hint}`),
        settings.paths ? `files  ${settings.paths.config} · ${settings.paths.commands}` : "",
      ].filter(Boolean).join("\n"), 12000);
    }
    const alias = settings.aliases[verb];
    if (alias) return runText(`${alias} ${arg}`.trim(), depth + 1);
    const mine = settings.commands.find((c) => c.name === verb);
    if (mine) return runUserCommand(mine, arg, depth);
    const loose = rows.find((row) => row.run && row.label.toLowerCase() === text.trim().toLowerCase());
    if (loose?.run) return void loose.run();
    return say(`E492: Not a command: ${verb}`);
  };

  // Everything the chrome offered: places, app commands, Glass's verbs, yours.
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const command of appCommands) {
      const isPlace = command.id.startsWith("nav:");
      const label = isPlace ? command.label.replace(/^(Go to|Open) /, "") : command.label;
      out.push({
        group: isPlace ? "Go" : "Commands",
        label,
        hint: "",
        fill: isPlace ? `go ${label.toLowerCase()}` : label,
        key: command.shortcut?.replace("Cmd+", "⌘"),
        run: () => { command.action(); },
      });
    }
    for (const c of GLASS_VERBS) {
      out.push({ group: "Glass", label: c.verb, hint: c.hint, fill: c.verb === "set" ? "set " : c.verb, key: c.alias?.[0], complete: c.verb === "set" });
    }
    for (const c of settings.commands) out.push({ group: "Yours", label: c.name, hint: c.hint, fill: c.name });
    for (const [name, to] of Object.entries(settings.aliases)) out.push({ group: "Aliases", label: name, hint: `= ${to}`, fill: name });
    return out;
  }, [appCommands, settings.aliases, settings.commands]);

  const hits: Row[] = useMemo(() => {
    if (line === null) return [];
    if (/^set\s/.test(line)) return suggestLine(line, settings, [], names);
    const words = line.trim().toLowerCase().replace(/^go\s+/, "").split(/\s+/).filter(Boolean);
    const groupOrder = ["Go", "Commands", "Glass", "Yours", "Aliases"];
    if (!words.length) {
      // Nothing typed: the places first, then a few of each kind for discovery.
      return groupOrder.flatMap((group) => rows.filter((row) => row.group === group).slice(0, group === "Go" ? 9 : 4));
    }
    const scored = rows.flatMap((row) => {
      const hay = row.label.toLowerCase();
      if (!words.every((w) => hay.includes(w) || row.hint.toLowerCase().includes(w))) return [];
      const score = hay.startsWith(words[0]!) ? 0 : hay.split(/\s+/).some((part) => part.startsWith(words[0]!)) ? 1 : 2;
      return [{ row, score }];
    });
    scored.sort((a, b) => a.score - b.score || groupOrder.indexOf(a.row.group) - groupOrder.indexOf(b.row.group));
    // Keep each group together once ranked, so the group labels read cleanly.
    const ranked = scored.slice(0, 14).map((s) => s.row);
    return groupOrder.flatMap((group) => ranked.filter((row) => row.group === group));
  }, [line, names, rows, settings]);

  const pick = (hit: Hint) => {
    const row = hit as Row;
    close();
    if (row.run) {
      void Promise.resolve(row.run()).catch((error: unknown) => say(String(error)));
      return;
    }
    void runText(hit.fill).catch((error: unknown) => say(String(error)));
  };

  const where = areaLabel(route);
  const Content = app.slots.Content;

  return (
    <div className={`glass glass-app i-${settings.ink}`} style={{ fontSize: settings.fontSize }}>
      <main className="glass-app__content" data-pane="center">
        <Content />
      </main>
      {line !== null && (
        <div className="glass-app__bar">
          <CommandBar
            lead=":"
            value={line}
            hits={hits}
            field={lineRef}
            placeholder="go anywhere, run anything"
            onChange={setLine}
            onPick={pick}
            onRun={(text) => { close(); void runText(text).catch((error: unknown) => say(String(error))); }}
            onClose={close}
          />
        </div>
      )}
      {line === null && (
        <span className={`glass-mode${echo ? " is-echo" : ""}`} aria-live="polite" title=": or ⌘K for the command bar">
          {echo ?? where.toLowerCase()}
        </span>
      )}
    </div>
  );
}
