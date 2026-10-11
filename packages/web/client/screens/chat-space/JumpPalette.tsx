/** ⌘K — jump to a channel or a member. Keyboard first, no mouse required. */

import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useFocusTrap } from "../../lib/keyboard-nav.ts";
import type { ConversationDefinition } from "@openscout/protocol";

import type { ChannelMemberView } from "./chat-api.ts";
import { MemberAvatar } from "./ChatAvatar.tsx";
import type { ConversationFacts } from "./ChannelSidebar.tsx";
import { channelLabel, isAgentMember, memberDisplayName } from "./chat-space-model.ts";

export type JumpTarget =
  | { kind: "channel"; id: string; label: string }
  | { kind: "member"; id: string; label: string; member: ChannelMemberView };

type Group = "rooms" | "direct" | "people";
const GROUP_LABEL: Record<Group, string> = { rooms: "Rooms", direct: "Direct", people: "People" };
const GROUP_LIMIT = 12;

type Row = { group: Group; target: JumpTarget; detail: string | null; unread: string | null; mentioned: boolean };

/** The query's first match, in ink and weight; the rest of the name stays body tone. */
export function highlightMatch(label: string, needle: string): ReactNode {
  const trimmed = needle.trim();
  if (!trimmed) return label;
  const at = label.toLowerCase().indexOf(trimmed.toLowerCase());
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className="chat-palette-match">{label.slice(at, at + trimmed.length)}</mark>
      {label.slice(at + trimmed.length)}
    </>
  );
}

function memberDetail(member: ChannelMemberView): string {
  if (isAgentMember(member)) return member.harness ?? "agent";
  if (member.kind === "operator") return "host";
  return "person";
}

export function JumpPalette({
  rooms,
  directs = [],
  members,
  facts = {},
  onPick,
  onClose,
}: {
  rooms: ConversationDefinition[];
  directs?: ConversationDefinition[];
  members: ChannelMemberView[];
  /** Sidebar facts per conversation: detail, unread chip, and recency. */
  facts?: Record<string, ConversationFacts>;
  onPick: (target: JumpTarget) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const { ref: dialogRef, onKeyDown: trapFocus } = useFocusTrap<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus goes back to wherever it was when the palette opened.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    const matches = (label: string) => !needle || label.toLowerCase().includes(needle);
    // Recent first: the latest activity the sidebar knows of, newest on top.
    const byRecency = (list: ConversationDefinition[]) =>
      [...list].sort((left, right) => (facts[right.id]?.at ?? 0) - (facts[left.id]?.at ?? 0));
    const conversationRows = (list: ConversationDefinition[], group: Group): Row[] =>
      byRecency(list)
        .map((conversation) => ({
          group,
          target: {
            kind: "channel" as const,
            id: conversation.id,
            label: group === "rooms" ? channelLabel(conversation.title).replace(/^#/u, "") : conversation.title,
          },
          detail: facts[conversation.id]?.detail ?? null,
          unread: facts[conversation.id]?.unread ?? null,
          mentioned: facts[conversation.id]?.mentioned ?? false,
        }))
        .filter((row) => matches(row.target.label))
        .slice(0, GROUP_LIMIT);
    const people: Row[] = members
      .map((member) => ({
        group: "people" as const,
        target: { kind: "member" as const, id: member.actorId, label: memberDisplayName(member), member },
        detail: memberDetail(member),
        unread: null,
        mentioned: false,
      }))
      .filter((row) => matches(row.target.label))
      .slice(0, GROUP_LIMIT);
    return [...conversationRows(rooms, "rooms"), ...conversationRows(directs, "direct"), ...people];
  }, [directs, facts, members, query, rooms]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const move = (step: number) => {
    if (rows.length === 0) return;
    setIndex((current) => (current + step + rows.length) % rows.length);
  };

  // Keep the keyboard's row in view as it walks past the fold.
  useEffect(() => {
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index, listId]);

  return (
    <div
      className="chat-scrim chat-palette-scrim"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={dialogRef} className="chat-palette" role="dialog" aria-modal="true" aria-label="Jump to a channel or person" onKeyDown={(event) => {
        trapFocus(event);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      }}>
        <div className="chat-palette-field">
          <Search size={16} strokeWidth={1.8} aria-hidden className="chat-palette-search" />
          <input
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[index] ? `${listId}-${index}` : undefined}
            value={query}
            placeholder="Jump to a channel or person"
            aria-label="Jump to a channel or person"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const picked = rows[index];
                if (picked) onPick(picked.target);
              }
            }}
          />
          <kbd className="chat-palette-key">esc</kbd>
        </div>
        <div id={listId} className="chat-palette-list" role="listbox" aria-label="Channels and people">
          {rows.length === 0 ? (
            <div className="chat-palette-empty">
              {query.trim() ? `No match for “${query.trim()}”` : "Nothing to jump to yet."}
            </div>
          ) : (
            rows.map((row, position) => {
              const active = position === index;
              const startsGroup = position === 0 || rows[position - 1]?.group !== row.group;
              return (
                <Fragment key={`${row.group}:${row.target.id}`}>
                  {startsGroup ? (
                    <div className="chat-palette-group" role="presentation">{GROUP_LABEL[row.group]}</div>
                  ) : null}
                  <button
                    type="button"
                    id={`${listId}-${position}`}
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    className="chat-palette-option"
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => { if (!active) setIndex(position); }}
                    onClick={() => onPick(row.target)}
                  >
                    <span className="chat-palette-lead" aria-hidden="true">
                      {row.target.kind === "member"
                        ? <MemberAvatar member={row.target.member} size={20} />
                        : <span className="chat-hash">#</span>}
                    </span>
                    <span className="chat-palette-name">{highlightMatch(row.target.label, query)}</span>
                    {row.unread ? (
                      <span className="chat-unread-chip" data-mentioned={row.mentioned}>{row.unread}</span>
                    ) : null}
                    {active
                      ? <kbd className="chat-palette-key chat-palette-enter">↵</kbd>
                      : row.detail ? <span className="chat-palette-detail">{row.detail}</span> : null}
                  </button>
                </Fragment>
              );
            })
          )}
        </div>
        <div className="chat-palette-foot" aria-hidden="true">
          <span><kbd className="chat-palette-key">↑↓</kbd> navigate</span>
          <span><kbd className="chat-palette-key">↵</kbd> open</span>
          <span><kbd className="chat-palette-key">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
