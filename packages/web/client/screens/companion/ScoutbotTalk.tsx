/**
 * Talk to Scoutbot from the desktop, and let it talk back.
 *
 * Talk: the shared reply box (Glass's: @recipient, mic, send, drop to attach)
 * sends one turn to /api/scoutbot/chat, the same assistant the app's Scoutbot
 * panel uses; an @agent or files go into that agent's conversation instead.
 * Voice: when on, Scoutbot speaks its replies and announces new requests
 * through Scout's own TTS. Off by default; kept with the Scoutbot prefs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "../../lib/api.ts";
import { ensureAgentChat } from "../../lib/agent-chat.ts";
import type { OutgoingAttachment } from "../../lib/media-blobs.ts";
import { isScoutbotAgent, resolveScoutbotAgent } from "../../lib/scoutbot.ts";
import { isAgentBusy } from "../../lib/agent-state.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Agent } from "../../lib/types.ts";
import { ensureOpenAIKeyOnServer } from "../../lib/credentials.ts";
import { isScoutSpeechStopped, startScoutSpeech, type ScoutSpeechHandle } from "../../lib/scout-voice.ts";
import type { ScoutbotAssistantReply } from "../../scout/scoutbot/scoutbot-model.ts";
import { scoutbotUiContext } from "../../../shared/scoutbot-navigation.ts";
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
} from "../glass/reply-kit.tsx";
import { openConversation, ScoutbotFigure, type ScoutbotLook } from "./Scoutbot.tsx";

/** One spoken line at a time: a new line stops the one playing. */
export function useScoutbotSpeech() {
  const handle = useRef<ScoutSpeechHandle | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    setSpeaking(false);
  }, []);
  const speak = useCallback((text: string) => {
    const line = text.trim();
    if (!line) return;
    handle.current?.stop();
    const next = startScoutSpeech(line);
    handle.current = next;
    setSpeaking(true);
    setError(null);
    next.promise
      .catch((cause: unknown) => {
        if (!isScoutSpeechStopped(cause) && handle.current === next) {
          setError(cause instanceof Error ? cause.message : "Scoutbot could not speak.");
        }
      })
      .finally(() => {
        if (handle.current !== next) return;
        handle.current = null;
        setSpeaking(false);
      });
  }, []);
  useEffect(() => () => handle.current?.stop(), []);
  return { speak, stop, speaking, error };
}

export type ScoutbotSpeech = ReturnType<typeof useScoutbotSpeech>;

/** What the panel shows under the requests: one exchange, or a note. */
type Turn = { said: string; reply: string | null; error: string | null; open?: string };

const COMMANDS: { verb: string; hint: string; complete?: boolean }[] = [
  { verb: "ask", hint: "@agent what to do", complete: true },
  { verb: "new", hint: "open a conversation with @agent", complete: true },
  { verb: "read", hint: "read the newest request aloud" },
  { verb: "hush", hint: "stop speaking" },
  { verb: "voice", hint: "spoken replies on or off" },
  { verb: "help", hint: "list commands" },
];

/** The command bar's suggestions here: the command, then its @agent or on/off. */
export function suggestScoutbot(text: string, agents: readonly string[]): Hint[] {
  const space = text.indexOf(" ");
  if (space < 0) {
    return COMMANDS.filter((c) => c.verb.startsWith(text))
      .map((c) => ({ group: "Commands", label: c.verb, hint: c.hint, fill: c.complete ? `${c.verb} ` : c.verb, complete: c.complete }));
  }
  const verb = text.slice(0, space);
  const rest = text.slice(space + 1);
  if ((verb === "ask" || verb === "new") && !rest.includes(" ")) {
    return rankByPrefix(agents.map((a) => `@${a}`), rest).slice(0, 8)
      .map((name) => ({ group: "Agents", label: name, hint: "", fill: verb === "ask" ? `ask ${name} ` : `new ${name}`, complete: verb === "ask" }));
  }
  if (verb === "voice") {
    return ["on", "off"].filter((v) => v.startsWith(rest))
      .map((v) => ({ group: "Voice", label: v, hint: v === "on" ? "replies and new requests are spoken" : "Scoutbot stays quiet", fill: `voice ${v}` }));
  }
  return [];
}

/**
 * The Scoutbot panel: requests are the content, one exchange sits under them,
 * and the shared reply box is the foot. Voice is a header icon; ":" brings up
 * the command bar over the panel; files dropped anywhere on it are attached.
 */
export function ScoutbotPanel({ name, look = "graphite", status, voice, speech, readAloud, onVoice, empty, children, style }: {
  name: string;
  /** Scoutbot's look, for its face in the empty panel. */
  look?: ScoutbotLook;
  status: string;
  voice: boolean;
  speech: ScoutbotSpeech;
  /** What `:read` says: the newest request, when there is one. */
  readAloud: string | null;
  onVoice: (on: boolean) => void;
  /** Nothing waiting: the panel says so and points at the command bar. */
  empty: boolean;
  /** The requests, newest first. */
  children: ReactNode;
  style: CSSProperties;
}) {
  const [draft, setDraft] = useState("");
  const [turn, setTurn] = useState<Turn | null>(null);
  const [sending, setSending] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const drop = useDroppedFiles();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lineRef = useRef<HTMLInputElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    let live = true;
    void api<Agent[]>("/api/agents").then((rows) => { if (live) setAgents(rows); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const names = useMemo(() => agentNames(agents), [agents]);
  /** Nothing waiting: who is mid-turn right now, newest first, up to three. */
  const working = useMemo(
    () => agents
      .filter((agent) => !agent.retiredFromFleet && !isScoutbotAgent(agent) && isAgentBusy(agent.state, agent))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, 3),
    [agents],
  );
  const headStatus = empty && working.length ? `${working.length} working` : status;

  /** Plain text to Scoutbot is a turn with the assistant; it can speak back. */
  const talk = async (said: string) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setTurn({ said, reply: null, error: null });
    try {
      await ensureOpenAIKeyOnServer().catch(() => null);
      const result = await api<ScoutbotAssistantReply>("/api/scoutbot/chat", {
        method: "POST",
        body: JSON.stringify({ body: said, uiContext: { ...scoutbotUiContext("web"), usageMode: "chat" } }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const reply = result.reply.body;
      setTurn({ said, reply, error: null });
      if (voice) speech.speak(reply);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setTurn({ said, reply: null, error: cause instanceof Error ? cause.message : "Could not reach Scoutbot." });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  };

  /** An @agent, or anything with files, goes into that agent's conversation. */
  const post = async (to: string | null, body: string, attachments: OutgoingAttachment[]) => {
    const agent = to ? findAgent(agents, to) : resolveScoutbotAgent(agents);
    if (!agent) throw new Error(to ? `No agent @${to}.` : "Scoutbot is not running.");
    const id = await ensureAgentChat(agent);
    await api(`/api/chats/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, clientMessageId: crypto.randomUUID(), ...(attachments.length ? { attachments } : {}) }),
    });
    return { id, label: to ? `@${to}` : name };
  };

  const send = async () => {
    const to = addressOf(draft);
    const body = withoutAddress(draft).trim();
    const files = drop.files;
    if ((!body && !files.length) || sending) return;
    setSending(true);
    try {
      if (!to && !files.length) {
        setDraft("");
        await talk(body);
        return;
      }
      const sent = await post(to, body, files);
      setDraft("");
      drop.clear();
      const what = files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : "";
      setTurn({ said: [body, what].filter(Boolean).join(" · "), reply: `Sent to ${sent.label}.`, error: null, open: sent.id });
    } catch (cause) {
      setTurn({ said: body, reply: null, error: cause instanceof Error ? cause.message : "Not sent." });
    } finally {
      setSending(false);
    }
  };

  const note = (said: string, reply: string, open?: string) => setTurn({ said, reply, error: null, open });

  const run = async (text: string) => {
    setLine(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    const [verb = "", ...words] = text.trim().split(/\s+/);
    const said = `:${text.trim()}`;
    if (!verb) return;
    try {
      switch (verb) {
        case "ask": {
          const [who = "", ...what] = words;
          if (!who.startsWith("@") || !what.length) return note(said, "ask @agent what to do");
          const sent = await post(who.slice(1), what.join(" "), []);
          return note(said, `Asked ${sent.label}.`, sent.id);
        }
        case "new": {
          const who = words[0] ?? "";
          const agent = who ? findAgent(agents, who) : resolveScoutbotAgent(agents);
          if (!agent) return note(said, `No agent ${who}.`);
          openConversation(await ensureAgentChat(agent));
          return note(said, `Opened ${who || name}.`);
        }
        case "read":
          if (!readAloud) return note(said, "Nothing to read.");
          return speech.speak(readAloud);
        case "hush":
          return speech.stop();
        case "voice": {
          const on = words[0] === "on" ? true : words[0] === "off" ? false : !voice;
          if (!on) speech.stop();
          onVoice(on);
          return note(said, on ? "Voice on: replies and new requests are spoken." : "Voice off.");
        }
        case "help":
        case "h":
          return note(said, COMMANDS.map((c) => `:${c.verb.padEnd(6)} ${c.hint}`).join("\n"));
        default:
          return note(said, `Not a command: ${verb}. :help lists them.`);
      }
    } catch (cause) {
      setTurn({ said, reply: null, error: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  return (
    <div className="ce-pop is-kept is-placed sbt-pop" role="dialog" aria-label={`${name} · Requests`} data-hit="popover" style={style} {...drop.handlers}>
      <header className="sbt-pop__head">
        <b>{name}</b>
        <span>{headStatus}</span>
        {speech.speaking && (
          <button type="button" className="rk-icon" title="Stop speaking" aria-label="Stop speaking" onClick={speech.stop}>
            <StopGlyph />
          </button>
        )}
        <button
          type="button"
          className={`rk-icon sbt-voice${voice ? " is-on" : ""}`}
          aria-pressed={voice}
          aria-label="Voice"
          title={voice ? "Voice on: replies and new requests are spoken" : "Voice off: Scoutbot stays quiet"}
          onClick={() => { if (voice) speech.stop(); onVoice(!voice); }}
        >
          <SpeakerGlyph on={voice} />
        </button>
      </header>

      <div className="sbt-pop__body">
        {children}
        {empty && !turn && (working.length ? (
          <div className="sbt-empty sbt-empty--glance">
            <div className="sbt-empty__head">
              <span className="sbt-empty__face"><ScoutbotFigure look={look} mood="rest" size={30} /></span>
              <div>
                <p className="sbt-empty__title">All clear</p>
                <p className="sbt-empty__note">Asks and permission requests land here.</p>
              </div>
            </div>
            <p className="sbt-empty__label">Working now</p>
            <ul className="sbt-working">
              {working.map((agent) => (
                <li key={agent.id}>
                  <button
                    type="button"
                    disabled={!agent.conversationId}
                    onClick={() => { if (agent.conversationId) openConversation(agent.conversationId); }}
                  >
                    <i aria-hidden="true" />
                    <b>{agent.handle ?? agent.name}</b>
                    <span>{agent.project ?? ""}</span>
                    <em>{agent.updatedAt ? timeAgo(agent.updatedAt) : ""}</em>
                  </button>
                </li>
              ))}
            </ul>
            <span className="sbt-empty__key"><kbd>:</kbd> for commands</span>
          </div>
        ) : (
          <div className="sbt-empty sbt-empty--lookout">
            <span className="sbt-empty__face sbt-empty__face--big"><ScoutbotFigure look={look} mood="rest" size={76} /></span>
            <p className="sbt-empty__title">All clear.</p>
            <p className="sbt-empty__note">Asks and permission requests from your agents land here.</p>
            <span className="sbt-empty__key"><kbd>:</kbd> for commands</span>
          </div>
        ))}
        {turn && (
          <div className="sbt-turn" aria-live="polite">
            <p className="sbt-turn__said">{turn.said}</p>
            {turn.error
              ? <p className="sbt-turn__error">{turn.error}</p>
              : <p className="sbt-turn__reply">{turn.reply ?? "Thinking…"}</p>}
            {turn.open && (
              <button type="button" className="sbt-open" onClick={() => openConversation(turn.open!)}>
                Open <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 8 8 4M4.5 4H8v3.5" /></svg>
              </button>
            )}
          </div>
        )}
        {(speech.error || micNote || drop.error) && <p className="sbt-turn__error">{speech.error ?? drop.error ?? micNote}</p>}
      </div>

      <div className="sbt-foot">
        {line !== null && (
          <CommandBar
            lead=":"
            value={line}
            hits={suggestScoutbot(line, names)}
            field={lineRef}
            onChange={setLine}
            onRun={(text) => void run(text)}
            onClose={() => { setLine(null); window.setTimeout(() => inputRef.current?.focus(), 0); }}
          />
        )}
        <ReplyBox
          to={name}
          draft={draft}
          onDraft={setDraft}
          onSend={() => void send()}
          files={drop.files}
          onRemoveFile={drop.remove}
          uploading={drop.uploading}
          sending={sending}
          placeholder={`Ask ${name}`}
          inputRef={inputRef}
          dim={line !== null}
          names={names}
          onFocus={() => setLine(null)}
          onCommand={() => { setLine(""); window.setTimeout(() => lineRef.current?.focus(), 0); }}
          onDictation={(text) => setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))}
          onMicNote={setMicNote}
        />
      </div>
      {drop.dropping && <DropVeil />}
    </div>
  );
}

function SpeakerGlyph({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 6h2.5l3-2.5v9L5 10H2.5z" />
      {on ? <path d="M10.5 5.6a3.2 3.2 0 0 1 0 4.8M12.3 4a5.6 5.6 0 0 1 0 8" /> : <path d="M10.6 6.2l3.4 3.6M14 6.2l-3.4 3.6" />}
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
