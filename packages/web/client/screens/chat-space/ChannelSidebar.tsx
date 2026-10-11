/**
 * The sidebar: channels, direct messages, and one quiet Invite action.
 *
 * No session rows, no sort chrome, no member counts — a teammate should parse
 * this in one glance. The accent appears here for exactly one reason: a row
 * holding something addressed to the viewer that is still owed. Ordinary
 * traffic reorders quietly and decorates nothing.
 *
 * Pin, archive, sort, latest-only, search, and a docked DM well live in the
 * Studio study `/studies/chat-space-rails`, not here, until that direction
 * is picked. Collapse and resize live on the column's header band
 * (ChatSpaceSurface), the same law as Scout's Hudson rails.
 *
 * The foot carries who you are. Identity used to sit in the top bar, which put
 * it as far from the channel list as the window allows; it belongs at the
 * bottom of the column it governs.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Users } from "lucide-react";
import type { ChatReadState, ConversationDefinition } from "@openscout/protocol";
import { summarizeChatReadState } from "../../../shared/chat-read-state.ts";

import type { ScoutThemePreference } from "../../lib/theme.ts";
import { useChatCapabilities } from "./chat-transport.tsx";
import { MemberCoin } from "./ChatAvatar.tsx";
import { SpaceSwitcher } from "./SpaceSwitcher.tsx";
import type { ChannelFeed, ChannelMemberView, ChatChannelLastMessage, ChatSpaceView } from "./chat-api.ts";
import { activityVerb, channelLabel, freshestRowPreview, isAgentMember, isStatusMessage, listTime, type RowPreview } from "./chat-space-model.ts";
import { chatMessagePreviewText } from "./chat-message-preview.ts";

const THEME_CHOICES: { value: ScoutThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

function moveFocus(container: HTMLElement | null, from: HTMLElement, delta: number) {
  if (!container) return;
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-side-row]"));
  const index = rows.indexOf(from);
  if (index < 0) return;
  const next = rows[(index + delta + rows.length) % rows.length];
  next?.focus();
}

/**
 * What the sidebar has seen of a conversation, from reads the surface already
 * made: the last message of a feed once it was opened, and the agent in a
 * direct chat once its roster was read. Nothing here is fetched per row, so a
 * room never opened this session has no preview and says so quietly.
 */
export interface SidebarRowSeen {
  preview?: RowPreview;
  harness?: string;
  working?: boolean;
}

const RECENT_MS = 15 * 60_000;

/** What the ⌘K palette shows beside a conversation: the sidebar's own facts. */
export interface ConversationFacts {
  detail: string | null;
  /** Chip text ("3", "3+"), or null when nothing is unread. */
  unread: string | null;
  mentioned: boolean;
  /** Latest activity we know of, for recency order; 0 when unknown. */
  at: number;
}

export function conversationFacts(
  conversation: ConversationDefinition,
  input: {
    readStates: Record<string, ChatReadState>;
    seen: Record<string, SidebarRowSeen>;
    lastMessages: Record<string, ChatChannelLastMessage>;
    viewerActorId: string | null;
  },
): ConversationFacts {
  const isDirect = conversation.kind === "direct" || conversation.kind === "group_direct";
  const readState = input.readStates[conversation.id];
  const attention = readState ? summarizeChatReadState(readState) : null;
  const unread = attention && (attention.unread > 0 || attention.incomplete)
    ? `${attention.unread || ""}${attention.incomplete ? "+" : ""}`
    : null;
  const facts = input.seen[conversation.id];
  const preview = freshestRowPreview(facts?.preview, input.lastMessages[conversation.id], input.viewerActorId);
  const people = conversation.participantIds?.length ?? 0;
  const detail = !isDirect
    ? people > 0 ? `${people} in the room` : null
    : conversation.kind === "group_direct"
      ? people > 0 ? `${people} in the chat` : null
      : facts?.harness ?? null;
  return { detail, unread, mentioned: Boolean(attention && attention.mentions > 0), at: preview?.at ?? 0 };
}

export function useSidebarSeen({
  channelId,
  feed,
  feedIsCurrent,
  members,
  membersAreCurrent,
  viewerActorId,
}: {
  channelId: string | null;
  feed: ChannelFeed | null;
  feedIsCurrent: boolean;
  members: ChannelMemberView[];
  membersAreCurrent: boolean;
  viewerActorId: string | null;
}): Record<string, SidebarRowSeen> {
  const [seen, setSeen] = useState<Record<string, SidebarRowSeen>>({});

  useEffect(() => {
    if (!channelId || !feed || !feedIsCurrent) return;
    const last = feed.messages
      .filter((message) => !message.replyToMessageId && !isStatusMessage(message))
      .reduce<ChannelFeed["messages"][number] | null>(
        (latest, message) => (!latest || message.createdAt >= latest.createdAt ? message : latest),
        null,
      );
    if (!last) return;
    const who = last.actorId === viewerActorId
      ? "You"
      : last.actorName?.trim()
        || members.find((member) => member.actorId === last.actorId)?.displayName
        || last.actorId;
    const preview = { who, text: chatMessagePreviewText(last), at: last.createdAt };
    setSeen((current) => {
      const before = current[channelId]?.preview;
      if (before && before.at === preview.at && before.text === preview.text && before.who === preview.who) return current;
      return { ...current, [channelId]: { ...current[channelId], preview } };
    });
  }, [channelId, feed, feedIsCurrent, members, viewerActorId]);

  useEffect(() => {
    if (!channelId || !membersAreCurrent) return;
    const agent = members.find((member) => member.actorId !== viewerActorId && isAgentMember(member));
    if (!agent) return;
    const harness = agent.harness?.trim() || undefined;
    const working = activityVerb(agent) === "working";
    setSeen((current) => {
      const before = current[channelId];
      if (before && before.harness === harness && before.working === working) return current;
      return { ...current, [channelId]: { ...before, harness, working } };
    });
  }, [channelId, members, membersAreCurrent, viewerActorId]);

  return seen;
}

type ListFilter = "all" | "direct" | "rooms";
const FILTERS: { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "direct", label: "Direct" },
  { value: "rooms", label: "Rooms" },
];

/** The rail has one glyph's worth of room: the hash, and the letter it starts with. */
function railGlyph(title: string): string {
  const name = title.replace(/^#/u, "").trim();
  return name.slice(0, 1).toLowerCase() || "?";
}


/**
 * Who you are, and the short menu behind it.
 *
 * Closes on Escape and on a pointer landing anywhere else — the surface's own
 * Escape handler closes the right panel, so this one stops the event once it
 * has used it.
 */
function SidebarIdentity({
  viewerName,
  viewerIsHost,
  railed,
  themePreference,
  onOpenProfile,
  onThemePreference,
  onSignOut,
}: {
  viewerName: string;
  viewerIsHost: boolean;
  railed: boolean;
  themePreference: ScoutThemePreference;
  onOpenProfile: (() => void) | null;
  onThemePreference: (next: ScoutThemePreference) => void;
  onSignOut: () => void;
}) {
  const capabilities = useChatCapabilities();
  const [menuOpen, setMenuOpen] = useState(false);
  const footRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    footRef.current?.querySelector<HTMLButtonElement>(".chat-you-menu button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && footRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const choose = useCallback((run: () => void) => {
    setMenuOpen(false);
    run();
  }, []);

  return (
    <div
      className="chat-sidebar-identity"
      ref={footRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen(false);
          footRef.current?.querySelector<HTMLButtonElement>(".chat-you")?.focus();
        }
      }}
    >
      {menuOpen ? (
        <div className="chat-you-menu" role="group" aria-label={`${viewerName} menu`}>
          <div className="chat-you-menu-head">
            <MemberCoin name={viewerName} size={28} title={viewerName} />
            <span className="chat-you-menu-name">{viewerName}</span>
          </div>
          <div className="chat-you-menu-rule" />
          {onOpenProfile ? (
            <button
              type="button"
              className="chat-you-menu-item"
              onClick={() => choose(onOpenProfile)}
            >
              Your member card
            </button>
          ) : null}
          <div className="chat-you-menu-group" role="group" aria-label="Appearance">
            <span className="label-sm">Appearance</span>
            <div className="chat-you-themes">
              {THEME_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className="btn btn--sm"
                  aria-pressed={themePreference === choice.value}
                  data-active={themePreference === choice.value}
                  onClick={() => onThemePreference(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
          {capabilities.signOut ? (
            <>
              <div className="chat-you-menu-rule" />
              <button
                type="button"
                className="chat-you-menu-item"
                onClick={() => choose(onSignOut)}
              >
                Sign out
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="chat-you"
        aria-expanded={menuOpen}
        aria-label={railed ? `${viewerName} — account menu` : undefined}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MemberCoin name={viewerName} size={24} title={viewerName} />
        {railed ? null : (
          <>
            <span className="chat-you-who">
              <span className="chat-you-name">{viewerName}</span>
              {viewerIsHost ? <span className="label-sm chat-you-role">Host</span> : null}
            </span>
            <span className="chat-you-caret" aria-hidden="true">{menuOpen ? "⌄" : "⌃"}</span>
          </>
        )}
      </button>
    </div>
  );
}

export function ChannelSidebar({
  channels,
  directs,
  spaces,
  activeSpace,
  selectedId,
  addressedChannelIds,
  readStates = {},
  questionCounts = {},
  seen = {},
  lastMessages = {},
  viewerActorId = null,
  nowMs,
  canCreate,
  viewerName,
  viewerIsHost,
  railed,
  themePreference,
  onSelect,
  onSelectSpace,
  onCreate,
  onCreateSpace,
  onDeleteSpace,
  onInvite,
  onOpenTeam,
  teamOpen,
  onExpandRail,
  onOpenProfile,
  onThemePreference,
  onSignOut,
}: {
  channels: ConversationDefinition[];
  directs: ConversationDefinition[];
  /** Every space this viewer can open, as the server listed them. */
  spaces: ChatSpaceView[];
  activeSpace: string;
  selectedId: string | null;
  addressedChannelIds: ReadonlySet<string>;
  readStates?: Record<string, ChatReadState>;
  questionCounts?: Record<string, number>;
  /** Previews and direct-chat facts from reads already made; see `useSidebarSeen`. */
  seen?: Record<string, SidebarRowSeen>;
  /** The server's summary of each room's last message, when it sends one. */
  lastMessages?: Record<string, ChatChannelLastMessage>;
  viewerActorId?: string | null;
  nowMs: number;
  canCreate: boolean;
  viewerName: string;
  viewerIsHost: boolean;
  railed: boolean;
  themePreference: ScoutThemePreference;
  onSelect: (id: string) => void;
  onSelectSpace: (slug: string) => void;
  onCreate: (input: { title: string; topic: string }) => Promise<void>;
  onDeleteSpace: ((slug: string) => Promise<void>) | null;
  onCreateSpace: (input: { title: string; channel: string }) => Promise<void>;
  onInvite: () => void;
  onOpenTeam: () => void;
  teamOpen: boolean;
  onExpandRail: () => void;
  /** Null while no channel is open, because the card lives in that channel's panel. */
  onOpenProfile: (() => void) | null;
  onThemePreference: (next: ScoutThemePreference) => void;
  onSignOut: () => void;
}) {
  const capabilities = useChatCapabilities();
  const listRef = useRef<HTMLElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ListFilter>("all");

  const submit = useCallback(async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate({ title: name, topic: topic.trim() });
      setTitle("");
      setTopic("");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }, [busy, onCreate, title, topic]);

  const row = (conversation: ConversationDefinition, isChannel: boolean) => {
    const questionCount = questionCounts[conversation.id] ?? 0;
    const questionLabel = `${questionCount} ${questionCount === 1 ? "question needs" : "questions need"} your response`;
    const addressed = addressedChannelIds.has(conversation.id);
    const readState = readStates[conversation.id];
    const attention = readState ? summarizeChatReadState(readState) : null;
    const unread = Boolean(attention && (attention.unread > 0 || attention.incomplete));
    const unreadLabel = attention
      ? `${attention.unread}${attention.incomplete ? "+" : ""} unread messages${attention.mentions ? `, ${attention.mentions} mentions` : ""}${attention.replies ? `, ${attention.replies} thread replies` : ""}`
      : undefined;
    const name = isChannel ? conversation.title.replace(/^#/u, "") : conversation.title;
    const facts = seen[conversation.id];
    const preview = freshestRowPreview(facts?.preview, lastMessages[conversation.id], viewerActorId);
    const people = conversation.participantIds?.length ?? 0;
    const detail = isChannel
      ? people > 0 ? `${people} in the room` : null
      : conversation.kind === "group_direct"
        ? people > 0 ? `${people} in the chat` : null
        : facts?.harness ?? null;
    const lamp = facts?.working
      ? "working"
      : preview && nowMs - preview.at < RECENT_MS ? "recent" : "idle";
    // Two lines, full width: who and when, then what was said last.
    const listRowBody = () => (
      <>
        <span className="chat-row-lead" aria-hidden="true">
          {isChannel ? <span className="chat-hash">#</span> : <span className="chat-lamp" data-state={lamp} />}
        </span>
        <span className="chat-row-main">
          <span className="chat-row-top">
            <span className="chat-row-name">{name}</span>
            <span className="chat-row-detail">{detail}</span>
            {preview ? <span className="chat-row-time">{listTime(preview.at, nowMs)}</span> : null}
          </span>
          <span className="chat-row-bottom">
            {preview ? (
              <span className="chat-row-preview">{preview.who}: {preview.text}</span>
            ) : (
              <span className="chat-row-preview" data-quiet="true">{conversation.topic?.trim() || "No preview"}</span>
            )}
            {questionCount > 0 ? <span id={`chat-questions-${conversation.id}`} className="chat-question-count" title={questionLabel} aria-label={questionLabel}>? {questionCount}</span> : null}
            {addressed ? (
              <span className="dot dot--accent dot--sm" aria-label="Addressed to you, unanswered" />
            ) : null}
            {unread && attention ? (
              <span id={`chat-unread-${conversation.id}`} className="chat-unread-chip" data-mentioned={attention.mentions > 0} aria-label={unreadLabel}>
                {`${attention.unread || ""}${attention.incomplete ? "+" : ""}`}
              </span>
            ) : null}
          </span>
        </span>
      </>
    );
    return (
      <button
        key={conversation.id}
        type="button"
        data-side-row
        data-channel-id={conversation.id}
        data-unread={unread}
        className={railed ? "chat-rail-row" : "chat-side-row"}
        aria-label={isChannel ? channelLabel(conversation.title) : name}
        aria-current={conversation.id === selectedId}
        data-addressed={addressed}
        title={unread ? `${name}: ${unreadLabel}` : railed ? (isChannel ? channelLabel(conversation.title) : name) : undefined}
        aria-describedby={[unread ? `chat-unread-${conversation.id}` : "", questionCount ? `chat-questions-${conversation.id}` : ""].filter(Boolean).join(" ") || undefined}
        onClick={() => onSelect(conversation.id)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveFocus(listRef.current, event.currentTarget, 1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(listRef.current, event.currentTarget, -1);
          }
        }}
      >
        {railed ? (
          isChannel ? (
            <span className="chat-rail-glyph">
              <span className="chat-hash">#</span>
              {railGlyph(conversation.title)}
            </span>
          ) : (
            <MemberCoin name={name} size={22} title={name} />
          )
        ) : (
          listRowBody()
        )}
        {railed && unread && attention ? (
          <span id={`chat-unread-${conversation.id}`} className="chat-unread-count" data-mentioned={attention.mentions > 0} aria-label={unreadLabel}>
            •
          </span>
        ) : null}
        {railed && questionCount > 0 ? <span id={`chat-questions-${conversation.id}`} className="chat-question-count" title={questionLabel} aria-label={questionLabel}>?</span> : null}
        {railed && addressed ? (
          <span className="dot dot--accent dot--sm" aria-label="Addressed to you, unanswered" />
        ) : null}
      </button>
    );
  };

  const shown = [
    ...(filter === "direct" ? [] : channels.map((conversation) => ({ conversation, isChannel: true }))),
    ...(filter === "rooms" ? [] : directs.map((conversation) => ({ conversation, isChannel: false }))),
  ];

  const spaceMenuUseful = spaces.length > 1 || (canCreate && capabilities.spaceCreate);
  const switcher = spaces.length > 0 ? (
    <SpaceSwitcher
      spaces={spaces}
      activeSlug={activeSpace}
      canCreate={canCreate && capabilities.spaceCreate}
      railed={railed}
      onSelect={onSelectSpace}
      onCreate={onCreateSpace}
      onDelete={canCreate ? onDeleteSpace : null}
      onExpandRail={onExpandRail}
    />
  ) : null;

  const identity = (
    <SidebarIdentity
      viewerName={viewerName}
      viewerIsHost={viewerIsHost}
      railed={railed}
      themePreference={themePreference}
      onOpenProfile={onOpenProfile}
      onThemePreference={onThemePreference}
      onSignOut={onSignOut}
    />
  );

  if (railed) {
    return (
      <nav
        className="chat-sidebar"
        data-railed="true"
        ref={listRef}
        aria-label="Channels and direct messages"
        onDoubleClick={(event) => {
          // Double-click on empty chrome expands, as it does on every other
          // collapsed rail in Scout. It costs no pixels.
          if ((event.target as HTMLElement).closest("button, a, [role='button']")) return;
          onExpandRail();
        }}
      >
        {switcher}
        <div className="chat-side-list">
          {channels.map((channel) => row(channel, true))}
          {directs.length > 0 ? <div className="chat-rail-rule" /> : null}
          {directs.map((direct) => row(direct, false))}
        </div>

        <div className="chat-sidebar-foot">
          {!capabilities.invitesRequireOwner || viewerIsHost ? <button type="button" className="chat-rail-row" aria-label="Invite someone" onClick={onInvite}>
            <span className="chat-rail-glyph">+</span>
          </button> : null}
          <button
            type="button"
            className="chat-rail-row"
            aria-label="Team"
            aria-pressed={teamOpen}
            onClick={onOpenTeam}
          >
            <Users size={16} aria-hidden="true" />
          </button>
        </div>
        {identity}
      </nav>
    );
  }

  return (
    <nav className="chat-sidebar" ref={listRef} aria-label="Channels and direct messages">
      <div className="chat-side-list">
        <div className="chat-side-controls">
          <div className="chat-side-filter" role="radiogroup" aria-label="Show conversations">
            {FILTERS.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={filter === choice.value}
                data-active={filter === choice.value}
                onClick={() => setFilter(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <span className="chat-side-count" aria-label={`${shown.length} ${shown.length === 1 ? "conversation" : "conversations"}`}>
            {shown.length}
          </span>
          {canCreate && capabilities.channelCreate ? (
            <button
              type="button"
              className="chat-side-add"
              aria-label="Create a channel"
              aria-expanded={creating}
              onClick={() => setCreating((open) => !open)}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {creating ? (
          <div className="chat-create-form">
            <input
              className="chat-input"
              value={title}
              autoFocus
              placeholder="channel-name"
              aria-label="Channel name"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setCreating(false);
                }
              }}
            />
            <input
              className="chat-input"
              value={topic}
              placeholder="Topic (optional)"
              aria-label="Channel topic"
              onChange={(event) => setTopic(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="chat-create-actions">
              <button type="button" className="btn btn--sm" disabled={busy || !title.trim()} onClick={() => void submit()}>
                {busy ? "Creating…" : "Create"}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {shown.length === 0 ? (
          <p className="chat-side-empty">
            {filter === "direct"
              ? "No direct chats in this space."
              : canCreate
                ? `No channels in ${spaces.find((space) => space.slug === activeSpace)?.title ?? "this space"} yet. Create one to get started.`
                : "You are not in any channel yet. Open the invitation you were sent."}
          </p>
        ) : (
          <div className="chat-side-rows">
            {shown.map(({ conversation, isChannel }) => row(conversation, isChannel))}
          </div>
        )}
      </div>

      {/* The list starts at the filter row. The space moved down here, and
          only when there is something to do with it — another space to
          switch to, or one to create. One space and no create: no row. */}
      {spaceMenuUseful ? <div className="chat-sidebar-space">{switcher}</div> : null}
      <div className="chat-sidebar-foot">
        {!capabilities.invitesRequireOwner || viewerIsHost ? <button type="button" className="btn btn--ghost btn--sm" onClick={onInvite}>
          + Invite
        </button> : null}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-pressed={teamOpen}
          onClick={onOpenTeam}
        >
          Team
        </button>
      </div>
      {identity}
    </nav>
  );
}
