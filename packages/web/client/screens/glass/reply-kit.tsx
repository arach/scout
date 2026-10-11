/* The reply kit both summonable surfaces share: the Glass window and the
   companion's Scoutbot panel. One reply box (@recipient, text, mic, send;
   files arrive by drop), and the black command bar that floats above it.
   Studio: design/studio/views/companion-scoutbot-panel.tsx and
   macos-glass-window.tsx. */

import { useEffect, useState, type DragEvent, type RefObject } from "react";

import { DictationMic, type MicStatus } from "../../components/DictationMic.tsx";
import {
  dataTransferMayContainFiles,
  readRoutableFiles,
  uploadMediaFiles,
  type OutgoingAttachment,
} from "../../lib/media-blobs.ts";
import type { Agent } from "../../lib/types.ts";
import "./reply-kit.css";

/** One suggestion row. `fill` is the whole line it completes to; `complete`
    means Return fills it in (it still needs an argument) instead of running it. */
export type Hint = { group: string; label: string; hint: string; fill: string; key?: string; complete?: boolean };

const ADDRESS = /^@([\w.-]+)\s/;

/** "@claude fix it" goes to claude; nothing typed means the surface's own recipient. */
export function addressOf(draft: string): string | null {
  return draft.match(ADDRESS)?.[1] ?? null;
}

/** "@claude", "claude" or an id: the agent it names. */
export function findAgent(agents: readonly Agent[], ref: string): Agent | undefined {
  const name = ref.replace(/^@/, "").toLowerCase();
  return agents.find((a) =>
    a.handle?.toLowerCase() === name
    || a.selector?.replace(/^@/, "").toLowerCase() === name
    || a.id.toLowerCase() === name
    || a.name.toLowerCase() === name);
}

/** What "@" offers: each agent's handle. */
export function agentNames(agents: readonly Agent[]): string[] {
  return agents.map((a) => a.handle ?? a.selector?.replace(/^@/, "") ?? "").filter(Boolean);
}

export function withoutAddress(draft: string): string {
  return draft.replace(ADDRESS, "");
}

/** Starts-with first, then anywhere once two letters are typed: "t" is terminals, not chat. */
export function rankByPrefix(items: readonly string[], typed: string): string[] {
  const q = typed.replace(/^@/, "").toLowerCase();
  const bare = (item: string) => item.replace(/^@/, "").toLowerCase();
  const first = items.filter((item) => bare(item).startsWith(q));
  const rest = q.length > 1 ? items.filter((item) => !bare(item).startsWith(q) && bare(item).includes(q)) : [];
  return [...first, ...rest];
}

function typedPart(value: string): string {
  const space = value.indexOf(" ");
  return (space < 0 ? value : value.slice(space + 1)).replace(/^@/, "").toLowerCase();
}

function Typed({ label, typed }: { label: string; typed: string }) {
  const lead = label.startsWith("@") ? "@" : "";
  const bare = label.slice(lead.length);
  if (!typed || !bare.toLowerCase().startsWith(typed)) return <>{label}</>;
  return <>{lead}<em>{bare.slice(0, typed.length)}</em>{bare.slice(typed.length)}</>;
}

/** The command bar: pitch black, lit from the top, floating just above the
    reply box. It covers what is behind it and never moves the reply box. */
export function CommandBar({ lead, value, hits, onChange, onRun, onPick, onClose, field, placeholder }: {
  lead: ":" | "/";
  value: string;
  hits: Hint[];
  onChange: (value: string) => void;
  onRun: (text: string) => void;
  /** Return on a highlighted row runs that row, whatever was typed (fuzzy lists). */
  onPick?: (hit: Hint) => void;
  onClose: () => void;
  field: RefObject<HTMLInputElement | null>;
  placeholder?: string;
}) {
  const [at, setAt] = useState(0);
  useEffect(() => setAt(0), [value]);
  const active = hits.length ? hits[Math.min(at, hits.length - 1)] : undefined;
  const typed = typedPart(value);

  const submit = () => {
    const text = value.trim();
    const fill = active?.fill.trim();
    if (onPick && active && !active.complete) return onPick(active);
    // Return on a half-typed line takes the highlighted suggestion.
    if (!active || !fill || fill === text || !fill.startsWith(text)) return onRun(text);
    if (active.complete) onChange(active.fill);
    else onRun(fill);
  };

  let group = "";
  return (
    <div className="rk-cbar" data-hit="command-bar">
      {hits.length > 0 && (
        <ul className="rk-cbar__hits" role="listbox">
          {hits.map((hit, index) => {
            const head = hit.group !== group ? (group = hit.group) : null;
            return (
              <li key={`${hit.group}:${hit.fill}`}>
                {head && <span className="rk-cbar__group">{head}</span>}
                <button
                  type="button"
                  role="option"
                  aria-selected={hit === active}
                  className={`rk-cbar__hit${hit === active ? " is-on" : ""}`}
                  onMouseMove={() => { if (at !== index) setAt(index); }}
                  onClick={() => {
                    if (onPick && !hit.complete) onPick(hit);
                    else { onChange(hit.fill); field.current?.focus(); }
                  }}
                >
                  <b><Typed label={hit.label} typed={typed} /></b>
                  <span>{hit.hint}</span>
                  {hit.key && <kbd>{hit.key}</kbd>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <form className="rk-cbar__line" data-field-shell onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <span className="rk-cbar__lead">{lead}</span>
        <input
          ref={field}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label={lead === ":" ? "Command" : "Search"}
          placeholder={placeholder ?? (lead === ":" ? "command" : "search this conversation")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || (event.key === "Backspace" && !value)) { event.preventDefault(); onClose(); }
            else if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) { event.preventDefault(); setAt((v) => Math.min(hits.length - 1, v + 1)); }
            else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) { event.preventDefault(); setAt((v) => Math.max(0, v - 1)); }
            else if (event.key === "Tab" && active) { event.preventDefault(); onChange(active.fill); }
          }}
        />
        <kbd>{lead === ":" ? "tab ↵" : "↵"}</kbd>
      </form>
    </div>
  );
}

/** Files dropped anywhere on the surface: uploaded at once, sent with the next message. */
export function useDroppedFiles() {
  const [dropping, setDropping] = useState(false);
  const [files, setFiles] = useState<OutgoingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlers = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dataTransferMayContainFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDropping(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!dataTransferMayContainFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDropping(false);
      const dropped = readRoutableFiles(event.dataTransfer);
      if (!dropped.length) { setError("Drop markdown, code, an image or a video."); return; }
      setError(null);
      setUploading(true);
      void uploadMediaFiles(dropped)
        .then((uploaded) => setFiles((prev) => [...prev, ...uploaded]))
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not attach that."))
        .finally(() => setUploading(false));
    },
  };

  return {
    dropping,
    files,
    uploading,
    error,
    handlers,
    remove: (id: string) => setFiles((prev) => prev.filter((file) => file.id !== id)),
    clear: () => { setFiles([]); setError(null); },
  };
}

export function DropVeil() {
  return <div className="rk-drop" aria-hidden><span>Drop to attach</span></div>;
}

/** The reply box: @recipient, the text, mic, send. ":" in an empty box asks for the command bar. */
export function ReplyBox({
  to,
  draft,
  onDraft,
  onSend,
  files = [],
  onRemoveFile,
  uploading = false,
  sending = false,
  placeholder = "Message",
  inputRef,
  onFocus,
  onEscape,
  onCommand,
  names = [],
  onDictation,
  onMicNote,
  dim = false,
  autoFocus = false,
}: {
  /** Who it goes to when no @name is typed. */
  to: string;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  files?: OutgoingAttachment[];
  onRemoveFile?: (id: string) => void;
  uploading?: boolean;
  sending?: boolean;
  placeholder?: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onFocus?: () => void;
  onEscape?: () => void;
  onCommand?: () => void;
  /** Agents to suggest after "@". */
  names?: readonly string[];
  onDictation: (text: string) => void;
  onMicNote?: (note: string | null) => void;
  /** The command bar is up: the box stays put, quieter. */
  dim?: boolean;
  autoFocus?: boolean;
}) {
  const other = addressOf(draft);
  const ready = withoutAddress(draft).trim().length > 0 || files.length > 0;
  const atHits = /^@[\w.-]*$/.test(draft) ? rankByPrefix(names, draft.slice(1)).slice(0, 6) : [];

  return (
    <div className="rk-reply-wrap">
      {atHits.length > 0 && (
        <ul className="rk-at" role="listbox" aria-label="Send to">
          {atHits.map((name, index) => (
            <li key={name}>
              <button type="button" role="option" aria-selected={index === 0} className={index === 0 ? "is-on" : undefined}
                onClick={() => { onDraft(`@${name} `); inputRef.current?.focus(); }}>
                @{name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className={`rk-reply${dim ? " is-dim" : ""}`}
        data-field-shell
        onSubmit={(event) => { event.preventDefault(); if (ready && !sending && !uploading) onSend(); }}
      >
        <span className={`rk-to${other ? " is-other" : ""}`} title={other ? `Sends to @${other}` : `Sends to ${to}`}>@{other ?? to}</span>
        {files.map((file) => (
          <button key={file.id} type="button" className="rk-file" title="Remove" onClick={() => onRemoveFile?.(file.id)}>
            {file.fileName ?? "file"}
          </button>
        ))}
        {uploading && <span className="rk-file is-busy">attaching…</span>}
        <input
          ref={inputRef}
          className="rk-reply__input"
          value={draft}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={`Message to ${other ?? to}`}
          onFocus={onFocus}
          onChange={(event) => {
            const next = event.target.value;
            if (onCommand && next === ":" && !draft) { onCommand(); return; }
            onDraft(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); onEscape?.(); }
            else if (event.key === "Tab" && atHits[0]) { event.preventDefault(); onDraft(`@${atHits[0]} `); }
          }}
        />
        <DictationMic
          className="rk-icon rk-mic"
          disabled={sending}
          onAppend={onDictation}
          onError={(message) => onMicNote?.(message)}
          onStatus={(status: MicStatus) => onMicNote?.(status.message ?? null)}
        />
        <button type="submit" className={`rk-icon rk-send${ready ? " is-ready" : ""}`} aria-label="Send" disabled={!ready || sending || uploading}>
          <svg viewBox="0 0 16 16" aria-hidden><path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" /></svg>
        </button>
      </form>
    </div>
  );
}
