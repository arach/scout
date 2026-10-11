import { useCallback, useEffect, useRef, useState } from "react";
import { HarnessMark, harnessLabel } from "../../components/HarnessMark.tsx";
import { HerdrMark } from "../../components/HerdrMark.tsx";
import { api } from "../../lib/api.ts";

/**
 * The context an emptyish terminal shows under its prompt.
 *
 * A fresh shell is one prompt line over a void. While the screen holds at
 * most EMPTYISH_LINES non-blank lines, the space below carries where the
 * terminal is: path and host, branch state, tree counts, head commit, and the
 * agents live in the same checkout. It is a dim layer under the screen, not
 * output — pointer-transparent, and gone as soon as output reaches it.
 *
 * Studied in design/studio/views/terminals-screenshot.tsx.
 */

const EMPTYISH_LINES = 2;

type TerminalContextAgent = {
  id: string;
  title: string;
  state: string | null;
  harness: string | null;
  backend: string;
  sessionName: string;
  cwd: string;
  command: string | null;
};

type TerminalContext = {
  host: string;
  displayCwd: string;
  shell: string | null;
  git: {
    root: string;
    branch: string | null;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
    staged: number;
    modified: number;
    untracked: number;
    head: { sha: string; subject: string; relative: string } | null;
  } | null;
  agentScope: "checkout" | "host";
  agents: TerminalContextAgent[];
  agentTotal: number;
};

type XtermLike = {
  buffer?: { active?: { length: number; getLine(y: number): { translateToString(trim?: boolean): string } | undefined } };
  onWriteParsed?: (listener: () => void) => { dispose(): void };
  onRender?: (listener: () => void) => { dispose(): void };
};

function countNonBlankLines(terminal: XtermLike): number | null {
  const buffer = terminal.buffer?.active;
  if (!buffer) return null;
  let count = 0;
  for (let y = 0; y < buffer.length; y += 1) {
    if (buffer.getLine(y)?.translateToString(true).trim()) {
      count += 1;
      if (count > EMPTYISH_LINES) break;
    }
  }
  return count;
}

/**
 * Watches an xterm instance and reports whether its screen is emptyish.
 * `track` is meant to be called from the relay's onReady.
 */
export function useEmptyishTerminal() {
  const [emptyish, setEmptyish] = useState(false);
  const disposeRef = useRef<(() => void) | null>(null);

  const track = useCallback((raw: unknown) => {
    disposeRef.current?.();
    const terminal = raw as XtermLike;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const count = countNonBlankLines(terminal);
      if (count !== null) setEmptyish(count <= EMPTYISH_LINES);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const subscription = terminal.onWriteParsed?.(schedule) ?? terminal.onRender?.(schedule);
    measure();
    disposeRef.current = () => {
      if (frame) cancelAnimationFrame(frame);
      subscription?.dispose();
    };
  }, []);

  useEffect(() => () => disposeRef.current?.(), []);

  return { emptyish, track };
}

function useTerminalContext(enabled: boolean, cwd?: string) {
  const [context, setContext] = useState<TerminalContext | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    api<{ ok: boolean; context: TerminalContext }>(`/api/terminal-context${query}`)
      .then((result) => {
        if (!cancelled && result?.context) setContext(result.context);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, cwd]);
  return context;
}

function branchState(git: NonNullable<TerminalContext["git"]>): string | null {
  if (!git.upstream) return git.branch ? "no upstream" : null;
  const parts: string[] = [];
  if (git.ahead) parts.push(`${git.ahead} ahead`);
  if (git.behind) parts.push(`${git.behind} behind`);
  return parts.length ? `${parts.join(" · ")} ${git.upstream}` : `in sync with ${git.upstream}`;
}

function treeState(git: NonNullable<TerminalContext["git"]>): string {
  const parts = [
    git.staged ? `${git.staged} staged` : null,
    git.modified ? `${git.modified} modified` : null,
    git.untracked ? `${git.untracked} untracked` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "clean";
}

/** What an agent row says after its title: harness when known, then where it lives. */
function agentMeta(agent: TerminalContextAgent): string {
  const where = agent.title === agent.sessionName ? agent.backend : `${agent.backend} ${agent.sessionName}`;
  return [agent.harness ? harnessLabel(agent.harness) : agent.command, where].filter(Boolean).join(" · ");
}

export function TerminalRestContext({ visible, cwd }: { visible: boolean; cwd?: string }) {
  const context = useTerminalContext(visible, cwd);
  if (!visible || !context) return null;
  const { git } = context;
  const toolchain = [context.host, context.shell].filter(Boolean).join(" · ");
  const scopeLabel = context.agentScope === "checkout" ? "Also in this checkout" : "Live on this host";

  return (
    <div className="s-term-rest" aria-label="Terminal context">
      <dl className="s-term-rest-facts">
        <dt>path</dt>
        <dd>
          {context.displayCwd}
          {toolchain ? <em>{toolchain}</em> : null}
        </dd>
        {git ? (
          <>
            <dt>branch</dt>
            <dd>
              {git.branch ?? "detached HEAD"}
              {branchState(git) ? <em>{branchState(git)}</em> : null}
            </dd>
            <dt>tree</dt>
            <dd>{treeState(git)}</dd>
            {git.head ? (
              <>
                <dt>head</dt>
                <dd>
                  {git.head.sha}
                  <em>
                    {git.head.relative} · {git.head.subject}
                  </em>
                </dd>
              </>
            ) : null}
          </>
        ) : null}
      </dl>
      {context.agents.length > 0 ? (
        <div className="s-term-rest-agents">
          <div className="s-term-rest-label">
            {scopeLabel} <em>{context.agentTotal}</em>
          </div>
          {context.agents.map((agent) => (
            <div key={agent.id} className="s-term-rest-agent">
              <span className="s-term-rest-mark">
                {agent.harness ? (
                  <HarnessMark harness={agent.harness} size={13} />
                ) : agent.backend === "herdr" ? (
                  <HerdrMark size={14} />
                ) : null}
              </span>
              <span className="s-term-rest-agent-title">{agent.title}</span>
              <span className="s-term-rest-agent-meta">{agentMeta(agent)}</span>
              <span
                className={`s-term-rest-agent-state${agent.state === "working" ? " s-term-rest-agent-state--working" : ""}`}
              >
                {agent.state === "working" ? <i /> : null}
                {agent.state}
              </span>
            </div>
          ))}
          {context.agentTotal > context.agents.length ? (
            <div className="s-term-rest-more">+{context.agentTotal - context.agents.length} more</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
