/* Glass: one conversation on a see-through window, vim keys, no shell.
   The Mac app hosts it chromeless (ScoutGlassWindow.swift); a browser can
   open /glass too and gets the same page minus the native commands.
   Studio: design/studio/views/macos-glass-window.tsx. Files: glass-config.ts. */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useScout } from "../../scout/Provider.tsx";
import { api } from "../../lib/api.ts";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import { loadConversationTail } from "../../lib/chat-cache.ts";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import { stripScoutbotUiFences } from "../../lib/scoutbot.ts";
import { useBrokerEventsRefresh } from "../../lib/sse.ts";
import { useConversationList } from "../../lib/use-conversation-list.ts";
import type { OutgoingAttachment } from "../../lib/media-blobs.ts";
import type { Message } from "../../lib/types.ts";
import {
  BUILTIN_COMMANDS,
  expandTemplate,
  findBuiltin,
  readGlassSettings,
  SET_KEYS,
  type GlassCommand,
  type GlassSettings,
} from "./glass-config.ts";
import {
  addressOf,
  agentNames,
  CommandBar,
  DropVeil,
  findAgent,
  rankByPrefix,
  ReplyBox,
  useDroppedFiles,
  withoutAddress,
  type Hint,
} from "./reply-kit.tsx";
import "./glass.css";

type Mode = "insert" | "nav";
type Line = { lead: ":" | "/"; text: string };

type GlassHost = { postMessage: (body: unknown) => void };
type GlassWindow = Window & {
  __SCOUT_GLASS__?: unknown;
  webkit?: { messageHandlers?: { scoutGlass?: GlassHost } };
};

/** The Mac app's handler; absent in a browser. */
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

function isOperator(message: Message): boolean {
  return message.actorId === "operator" || message.class === "operator";
}

export function GlassSurface() {
  const { agents, scoutbotConversationId, scoutbotAgentId } = useScout();
  const { sessions } = useConversationList();
  const settings = useGlassSettings();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mode, setMode] = useState<Mode>("insert");
  const [sel, setSel] = useState(0);
  const [draft, setDraft] = useState("");
  const [line, setLine] = useState<Line | null>(null);
  const [echo, setEcho] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const drop = useDroppedFiles();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lineRef = useRef<HTMLInputElement | null>(null);
  const echoTimer = useRef(0);
  const pendingG = useRef(0);

  // The window is the glass: nothing of the page paints behind the content.
  useEffect(() => {
    document.documentElement.classList.add("glass-page");
    return () => document.documentElement.classList.remove("glass-page");
  }, []);

  const say = useCallback((text: string, ms = 3200) => {
    setEcho(text);
    window.clearTimeout(echoTimer.current);
    echoTimer.current = window.setTimeout(() => setEcho(null), ms);
  }, []);

  useEffect(() => {
    if (settings.errors.length) say(settings.errors.join("\n"), 8000);
  }, [settings.errors, say]);
  useEffect(() => {
    const onError = (event: Event) => say(String((event as CustomEvent).detail?.message ?? "error"));
    window.addEventListener("scout-glass-error", onError);
    return () => window.removeEventListener("scout-glass-error", onError);
  }, [say]);

  const conversations = useMemo(
    () => [...sessions].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)),
    [sessions],
  );
  const current = conversations.find((c) => c.id === conversationId || c.equivalentConversationIds?.includes(conversationId ?? ""));
  const title = current?.title ?? (conversationId === scoutbotConversationId ? "Scoutbot" : "");

  const chatWith = useCallback(async (ref: string): Promise<string | null> => {
    if (ref === "scoutbot") {
      if (scoutbotConversationId) return scoutbotConversationId;
      const bot = agents.find((a) => a.id === scoutbotAgentId);
      return bot ? ensureAgentChat(bot) : null;
    }
    if (ref.startsWith("@")) {
      const agent = findAgent(agents, ref);
      return agent ? ensureAgentChat(agent) : null;
    }
    return ref;
  }, [agents, scoutbotAgentId, scoutbotConversationId]);

  // Start where the config says, once the agents are known.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || (!agents.length && settings.start !== "scoutbot")) return;
    if (settings.start === "scoutbot" && !scoutbotConversationId && !agents.length) return;
    started.current = true;
    void chatWith(settings.start).then((id) => {
      if (id) setConversationId(id);
      else say(`E94: No conversation for start: ${settings.start}`);
    }).catch((error: unknown) => say(String(error)));
  }, [agents.length, chatWith, scoutbotConversationId, settings.start, say]);

  const refresh = useCallback(() => {
    if (!conversationId) return;
    void loadConversationTail(conversationId, { refresh: true }).then(setMessages).catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let live = true;
    void loadConversationTail(conversationId).then((rows) => {
      if (!live) return;
      setMessages(rows);
      setSel(Math.max(0, rows.length - 1));
    }).catch((error: unknown) => say(String(error)));
    return () => { live = false; };
  }, [conversationId, say]);

  const equivalent = useMemo(
    () => new Set([conversationId, ...(current?.equivalentConversationIds ?? [])].filter(Boolean) as string[]),
    [conversationId, current],
  );
  useBrokerEventsRefresh(
    (event) => {
      if (event.kind !== "message.posted") return false;
      const id = (event.payload as { message?: { conversationId?: string } } | undefined)?.message?.conversationId;
      return Boolean(id && equivalent.has(id));
    },
    refresh,
  );

  const last = Math.max(0, messages.length - 1);
  // Follow the bottom while typing; hold still while reading in Nav.
  useEffect(() => {
    if (mode === "insert") listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, mode]);
  useEffect(() => {
    if (mode !== "nav") return;
    listRef.current?.querySelectorAll<HTMLElement>(".glass-msg")[sel]?.scrollIntoView({ block: "nearest" });
  }, [mode, sel]);

  const postTo = useCallback(async (id: string, body: string, attachments: OutgoingAttachment[] = []) => {
    await api(`/api/chats/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, clientMessageId: crypto.randomUUID(), ...(attachments.length ? { attachments } : {}) }),
    });
  }, []);

  useEffect(() => { if (drop.error) say(drop.error); }, [drop.error, say]);

  // "@name text" goes to that agent and the window follows it there.
  const send = useCallback(async () => {
    const other = addressOf(draft);
    const body = withoutAddress(draft).trim();
    if ((!body && !drop.files.length) || sending) return false;
    const target = other ? await chatWith(`@${other}`) : conversationId;
    if (!target) { say(other ? `E94: No agent @${other}` : "no conversation yet"); return false; }
    setSending(true);
    try {
      await postTo(target, body, drop.files);
      setDraft("");
      drop.clear();
      if (target !== conversationId) { setConversationId(target); say(`sent to @${other}`); }
      else refresh();
      return true;
    } catch (error) {
      say(`not sent: ${String(error)}`);
      return false;
    } finally {
      setSending(false);
    }
  }, [chatWith, conversationId, draft, drop, postTo, refresh, say, sending]);

  const switchTo = useCallback((index: number) => {
    if (!conversations.length) return;
    const n = (index + conversations.length) % conversations.length;
    setConversationId(conversations[n]!.id);
    say(`"${conversations[n]!.title}"`);
  }, [conversations, say]);
  const currentIndex = conversations.findIndex((c) => c === current);

  const toNav = () => { setMode("nav"); setSel(last); inputRef.current?.blur(); rootRef.current?.focus(); };
  const toInsert = () => { setMode("insert"); window.setTimeout(() => inputRef.current?.focus(), 0); };
  const openLine = (lead: ":" | "/") => { setLine({ lead, text: "" }); window.setTimeout(() => lineRef.current?.focus(), 0); };
  // Back where the bar was summoned from: the reply box in Insert, the list in Nav.
  const closeLine = () => {
    setLine(null);
    if (mode === "insert") window.setTimeout(() => inputRef.current?.focus(), 0);
    else rootRef.current?.focus();
  };

  const selectionText = () => listRef.current?.querySelectorAll<HTMLElement>(".glass-msg__body")[sel]?.innerText ?? "";

  const hitsFor = (pattern: string) => {
    const out: number[] = [];
    if (!pattern) return out;
    listRef.current?.querySelectorAll<HTMLElement>(".glass-msg").forEach((n, i) => {
      if (n.textContent?.toLowerCase().includes(pattern.toLowerCase())) out.push(i);
    });
    return out;
  };
  const jump = (pattern: string, dir: 1 | -1, from: number) => {
    const hits = hitsFor(pattern);
    if (!hits.length) { say(`E486: Pattern not found: ${pattern}`); return; }
    const next = dir === 1
      ? hits.find((h) => h > from) ?? hits[0]!
      : [...hits].reverse().find((h) => h < from) ?? hits[hits.length - 1]!;
    setSel(next);
    say(`/${pattern}  [${hits.indexOf(next) + 1}/${hits.length}]`);
  };

  const runUserCommand = async (command: GlassCommand, args: string, depth: number) => {
    if (command.run) return runLine(`${command.run} ${args}`.trim(), depth + 1);
    const body = expandTemplate(command.say ?? "", { args, selection: selectionText(), conversation: conversationId ?? "" });
    if (!body) return say(`:${command.name} has nothing to say`);
    const target = command.to === "here" ? conversationId : await chatWith(command.to);
    if (!target) return say(`E94: No conversation for ${command.to}`);
    await postTo(target, body);
    if (target !== conversationId) setConversationId(target);
    else refresh();
    say(`:${command.name} → ${command.to}`);
  };

  // One command line, built-ins first, then aliases, then your commands.
  const runLine = async (text: string, depth = 0): Promise<void> => {
    if (depth > 4) return say("E132: Command loops back on itself");
    const [verb = "", ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ");
    if (!verb) return;
    const builtin = findBuiltin(verb);
    if (!builtin) {
      const alias = settings.aliases[verb];
      if (alias) return runLine(`${alias} ${arg}`.trim(), depth + 1);
      const mine = settings.commands.find((c) => c.name === verb);
      if (mine) return runUserCommand(mine, arg, depth);
      return say(`E492: Not a command: ${verb}`);
    }
    switch (builtin.verb) {
      case "go": {
        if (!arg) return say("go where? terminals · projects · chat · home · requests");
        const host = native();
        if (!host) return say("go needs the Mac app");
        host.postMessage({ type: "go", section: arg });
        return;
      }
      case "buffer": {
        const n = Number(arg);
        const idx = Number.isInteger(n) && n > 0
          ? n - 1
          : conversations.findIndex((c) => c.title.toLowerCase().includes(arg.toLowerCase()));
        if (!arg || idx < 0 || idx >= conversations.length) return say(`E94: No matching conversation: ${arg}`);
        return switchTo(idx);
      }
      case "ls":
        return say(conversations.slice(0, 12).map((c, i) => `${String(i + 1).padStart(2)}${c === current ? " %" : "  "} ${c.title}`).join("\n"), 8000);
      case "new": {
        const id = await chatWith(arg || "scoutbot");
        if (!id) return say(`E94: No agent ${arg}`);
        setConversationId(id);
        return toInsert();
      }
      case "ask": {
        const [who = "", ...words] = arg.split(/\s+/);
        if (!who.startsWith("@") || !words.length) return say("ask @agent what to do");
        const id = await chatWith(who);
        if (!id) return say(`E94: No agent ${who}`);
        await postTo(id, words.join(" "));
        return say(`asked ${who}`);
      }
      case "write":
        if (!draft.trim()) return say("nothing to send");
        if (await send()) say("sent");
        return;
      case "set": {
        const [key = "", value = ""] = arg.split("=");
        const spec = SET_KEYS[key.toLowerCase()];
        const parsed = spec?.parse(value.trim());
        if (!spec || parsed == null) return say(`E518: Unknown option: ${arg}`);
        const host = native();
        if (!host) return say("set writes glass/config.json from the Mac app");
        host.postMessage({ type: "set", key: spec.path, value: parsed });
        return say(`${key}=${value}`);
      }
      case "reload":
        native()?.postMessage({ type: "reload" });
        return say("reloaded");
      case "quit": {
        const host = native();
        if (!host) return say("quit needs the Mac app");
        host.postMessage({ type: "quit" });
        return;
      }
      case "help":
        return say([
          ...BUILTIN_COMMANDS.map((c) => `:${c.verb.padEnd(7)} ${c.hint}`),
          ...settings.commands.map((c) => `:${c.name.padEnd(7)} ${c.hint}`),
          ...Object.entries(settings.aliases).map(([k, v]) => `:${k.padEnd(7)} = ${v}`),
          settings.paths ? `files  ${settings.paths.config} · ${settings.paths.commands}` : "",
        ].filter(Boolean).join("\n"), 12000);
    }
  };

  const run = (submitted: string) => {
    if (!line) return;
    const text = submitted.trim();
    if (line.lead === "/") {
      setLine(null);
      rootRef.current?.focus();
      if (text) { setQuery(text); jump(text, 1, sel); }
      return;
    }
    closeLine();
    if (text) void runLine(text).catch((error: unknown) => say(String(error)));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (mode !== "nav" || line || event.metaKey || event.altKey) return;
    const k = event.key;
    const handled = () => event.preventDefault();
    const page = Math.max(1, Math.floor(messages.length / 4));
    if (event.ctrlKey) {
      if (k === "d") { setSel((v) => Math.min(last, v + page)); handled(); }
      else if (k === "u") { setSel((v) => Math.max(0, v - page)); handled(); }
      return;
    }
    if (k === "j" || k === "ArrowDown") { setSel((v) => Math.min(last, v + 1)); handled(); }
    else if (k === "k" || k === "ArrowUp") { setSel((v) => Math.max(0, v - 1)); handled(); }
    else if (k === "G") { setSel(last); handled(); }
    else if (k === "g") {
      const now = Date.now();
      if (now - pendingG.current < 450) { setSel(0); pendingG.current = 0; } else pendingG.current = now;
      handled();
    }
    else if (k === "]") { switchTo(currentIndex + 1); handled(); }
    else if (k === "[") { switchTo(currentIndex - 1); handled(); }
    else if (k === "i" || k === "a" || k === "Enter") { toInsert(); handled(); }
    else if (k === ":") { openLine(":"); handled(); }
    else if (k === "/") { openLine("/"); handled(); }
    else if (k === "n" && query) { jump(query, 1, sel); handled(); }
    else if (k === "N" && query) { jump(query, -1, sel); handled(); }
    else if (k === "y") {
      void navigator.clipboard?.writeText(selectionText()).catch(() => {});
      say("1 message yanked");
      handled();
    }
  };

  // Live search highlight, vim's incsearch.
  const pattern = line?.lead === "/" ? line.text : query;
  useEffect(() => {
    const registry = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!registry || !HighlightCtor) return;
    const ranges: Range[] = [];
    const list = listRef.current;
    if (list && pattern) {
      const needle = pattern.toLowerCase();
      const walk = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const hay = (node.textContent ?? "").toLowerCase();
        for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
          const range = new Range();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          ranges.push(range);
        }
      }
    }
    registry.set("glass-search", new HighlightCtor(...ranges));
    return () => { registry.delete("glass-search"); };
  }, [pattern, messages]);

  const names = useMemo(() => agentNames(agents), [agents]);
  const hits = line?.lead === ":" ? suggest(line.text, settings, conversations.map((c) => c.title), names) : [];

  return (
    <div
      ref={rootRef}
      className={`glass i-${settings.ink}`}
      style={{ fontSize: settings.fontSize }}
      tabIndex={-1}
      onKeyDown={onKey}
      {...drop.handlers}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("input, button, a, .rk-cbar, .rk-reply-wrap")) { setLine(null); toNav(); }
      }}
    >
      <div className="glass-convo">
        <div ref={listRef} className="glass-list">
          {messages.map((message, i) => {
            const mine = isOperator(message);
            return (
              <div key={message.id} className={`glass-msg${mine ? " is-you" : ""}${mode === "nav" && i === sel ? " is-sel" : ""}`}>
                {!mine && <span className="glass-msg__name">{message.actorName}</span>}
                <div className="glass-msg__body">
                  <MessageMarkup text={stripScoutbotUiFences(message.body)} />
                </div>
              </div>
            );
          })}
          {conversationId && !messages.length && <p className="glass-empty">{title || "New conversation"}</p>}
        </div>

        {/* The command bar floats over the conversation; the reply box never moves. */}
        <div className="glass-foot">
          {line && (
            <CommandBar
              lead={line.lead}
              value={line.text}
              hits={hits}
              field={lineRef}
              onChange={(text) => setLine({ lead: line.lead, text })}
              onRun={run}
              onClose={closeLine}
            />
          )}
          <ReplyBox
            to={title || "Scoutbot"}
            draft={draft}
            onDraft={setDraft}
            onSend={() => void send()}
            files={drop.files}
            onRemoveFile={drop.remove}
            uploading={drop.uploading}
            sending={sending}
            placeholder={title ? `Reply to ${title}` : "Reply"}
            inputRef={inputRef}
            autoFocus
            dim={Boolean(line)}
            names={names}
            onFocus={() => { setMode("insert"); setLine(null); }}
            onEscape={toNav}
            onCommand={() => openLine(":")}
            onDictation={(text) => setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))}
            onMicNote={(note) => { if (note) say(note); }}
          />
        </div>
      </div>

      {drop.dropping && <DropVeil />}
      {!line && (
        <span className={`glass-mode${echo ? " is-echo" : ""}`} aria-live="polite">
          {echo ?? mode}
        </span>
      )}
    </div>
  );
}

const PLACES = ["home", "chat", "projects", "terminals", "dispatch", "search", "ops", "requests"];
const SET_HINTS: Record<string, string> = {
  tint: "0 – 0.95",
  material: "ghostty · liquid",
  chrome: "gone · strip",
  ink: "scout · lacquer",
  fontsize: "10 – 22",
  start: "scoutbot · @agent · conversation id",
};
const SET_VALUES: Record<string, string[]> = {
  material: ["ghostty", "liquid"],
  chrome: ["gone", "strip"],
  ink: ["scout", "lacquer"],
};
const NEEDS_ARG = new Set(["go", "buffer", "ask", "set"]);

/** What the command bar offers: the command first, then its arguments. */
export function suggest(text: string, settings: GlassSettings, titles: readonly string[], agents: readonly string[]): Hint[] {
  const space = text.indexOf(" ");
  if (space < 0) {
    const head = text;
    const commands = BUILTIN_COMMANDS.flatMap((c): Hint[] => {
      const name = c.verb.startsWith(head) ? c.verb : c.alias?.find((a) => a.startsWith(head));
      if (!name) return [];
      const complete = NEEDS_ARG.has(c.verb);
      return [{ group: "Commands", label: c.verb, hint: c.hint, fill: complete ? `${name} ` : name, key: c.alias?.[0], complete }];
    });
    const mine = settings.commands
      .filter((c) => c.name.startsWith(head))
      .map((c): Hint => ({ group: "Yours", label: c.name, hint: c.hint, fill: c.name }));
    const aliases = Object.entries(settings.aliases)
      .filter(([name]) => name.startsWith(head))
      .map(([name, to]): Hint => ({ group: "Aliases", label: name, hint: `= ${to}`, fill: name }));
    return [...commands, ...mine, ...aliases];
  }
  const verb = text.slice(0, space);
  const rest = text.slice(space + 1);
  switch (findBuiltin(verb)?.verb) {
    case "go":
      return rankByPrefix(PLACES, rest).map((place) => ({ group: "Places", label: place, hint: "", fill: `${verb} ${place}` }));
    case "buffer": {
      const q = rest.toLowerCase();
      return titles
        .map((title, i) => ({ title, n: i + 1 }))
        .filter(({ title, n }) => !q || title.toLowerCase().includes(q) || String(n).startsWith(q))
        .slice(0, 9)
        .map(({ title, n }) => ({ group: "Conversations", label: String(n), hint: title, fill: `${verb} ${n}` }));
    }
    case "new":
    case "ask": {
      if (rest.includes(" ")) return [];
      const ask = verb.startsWith("a");
      return rankByPrefix(agents.map((a) => `@${a}`), rest).slice(0, 8)
        .map((name) => ({ group: "Agents", label: name, hint: "", fill: ask ? `${verb} ${name} ` : `${verb} ${name}`, complete: ask }));
    }
    case "set": {
      const eq = rest.indexOf("=");
      if (eq < 0) {
        return rankByPrefix(Object.keys(SET_KEYS), rest)
          .map((key) => ({ group: "Options", label: `${key}=`, hint: SET_HINTS[key] ?? "", fill: `set ${key}=`, complete: true }));
      }
      const key = rest.slice(0, eq).toLowerCase();
      return (SET_VALUES[key] ?? [])
        .filter((value) => value.startsWith(rest.slice(eq + 1)))
        .map((value) => ({ group: "Options", label: `${key}=${value}`, hint: "", fill: `set ${key}=${value}` }));
    }
    default:
      return [];
  }
}
