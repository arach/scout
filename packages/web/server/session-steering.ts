import { hostname } from "node:os";
import { readClaudeSessionRecords, type ClaudeSessionRecord } from "@openscout/runtime";
import { execSystemFile, readHerdrTopology } from "@openscout/runtime/system-probes";
import { readScoutBrokerHealth } from "./core/broker/service.ts";
import type { SessionSteerAvailability, SessionSteerTarget } from "../shared/api/session-steer.ts";

// This web boundary is deliberately stricter than session_send's discovery:
// native session -> ONE birth-checked process -> an exact, live host address.
// No agent, cwd, title, default pane, native-app deep link, or resume fallback.
type HostEnv = Partial<Record<"TERM_PROGRAM" | "HERDR_SESSION" | "HERDR_PANE_ID" | "ORCA_TERMINAL_HANDLE" | "ORCA_PANE_KEY" | "ORCA_WORKTREE_ID" | "TMUX" | "TMUX_PANE", string>>;
type HostLocation = { host: "herdr"; session: string; paneId: string }
  | { host: "orca"; terminalHandle: string; paneKey: string | null; worktreeId: string | null }
  | { host: "tmux"; pane: string };
type HerdrPane = { session: string; paneId: string; status: string | null };
type OrcaAgent = { paneKey: string; agentType: string | null; state: "working" | "blocked" | "waiting" | "done" | "unknown"; worktreeId: string; worktreePath: string | null; lastAssistantMessage: string | null };
type Process = { pid: number; parent: number; start: string; tty: string | null; foreground: boolean };
type Binding = { sessionId: string; harness: "claude" | "codex"; target: SessionSteerTarget; record: ClaudeSessionRecord | null; host: HostLocation | null; herdr: HerdrPane | null; orca: OrcaAgent[] };
type Bound = { available: true; binding: Binding } | { available: false; code: string; reason: string; target: SessionSteerTarget | null };

// The interface is the runtime API in PR #1236. Keep that implementation in
// runtime; this layer only restricts its discovery and records operator input.
export type InPlaceRuntime = {
  readProcessHostEnv(pid: number): Promise<HostEnv>;
  innermostProcessHost(env: HostEnv): HostLocation | null;
  processHostLocations(env: HostEnv): HostLocation[];
  resolveInPlaceOrder(): SessionSteerTarget["host"][];
  codexThreadHolderPids(id: string): Promise<number[]>;
  codexThreadHeldByChatGPTApp(id: string): Promise<boolean>;
  readOrcaAgents(): Promise<OrcaAgent[]>;
  isScoutBackgroundCopy(record: ClaudeSessionRecord): boolean;
  deliverInPlace(input: { sessionId: string; harness: string; body: string }, deps: {
    findHerdrPane: () => Promise<HerdrPane | null>;
    findClaudeRecord: () => Promise<ClaudeSessionRecord | null>;
    codexThreadPids: () => Promise<number[]>;
    locateProcess: () => Promise<HostLocation | null>;
    codexHeldByApp: () => Promise<boolean>;
    readOrcaAgents: () => Promise<OrcaAgent[]>;
    ttyForPid: () => Promise<string | null>;
    selfTty: () => Promise<string | null>;
    self: HostLocation[];
    order: SessionSteerTarget["host"][];
  }): Promise<{ ok: boolean; code?: string }>;
};

export type SessionSteeringDeps = {
  runtime: InPlaceRuntime;
  machine: () => Promise<string | null>;
  records: () => Promise<ClaudeSessionRecord[]>;
  process: (pid: number) => Promise<Process | null>;
  self: () => Promise<{ pids: number[]; ttys: string[]; hosts: HostLocation[] }>;
  herdr: (session: string) => ReturnType<typeof readHerdrTopology>;
  tmux: (pane: string) => Promise<{ socket: string; pid: number; tty: string | null; pane: string; session: string } | null>;
};
const refused = (code: string, reason: string, target: SessionSteerTarget | null = null): Extract<Bound, { available: false }> => ({ available: false, code, reason, target });
const normalize = (s: string) => s.trim().replace(/\s+/gu, " ");
const ttyName = (s: string) => !s || s === "??" || s === "?" ? null : s.replace(/^\/dev\//u, "");

async function readProcess(pid: number): Promise<Process | null> {
  try {
    const { stdout } = await execSystemFile("ps", ["-p", String(pid), "-o", "ppid=,tty=,pgid=,tpgid=,lstart="], {
      timeoutMs: 2_000, maxStdoutBytes: 2048, env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
    });
    const [parent, tty, pgid, tpgid, ...start] = stdout.trim().split(/\s+/u);
    if (!Number(parent) || !start.length) return null;
    return { pid, parent: Number(parent), tty: ttyName(tty), foreground: Number(pgid) > 0 && pgid === tpgid, start: start.join(" ") };
  } catch (error) {
    if ((error as { exitCode?: number }).exitCode === 1) return null;
    throw error;
  }
}

async function caller(runtime: InPlaceRuntime) {
  const pids: number[] = [], ttys: string[] = [];
  const hosts = runtime.processHostLocations(process.env as HostEnv);
  let pid = process.pid;
  for (let depth = 0; depth < 16 && pid > 1; depth++) {
    pids.push(pid);
    const processInfo = await readProcess(pid);
    if (!processInfo) break;
    if (processInfo.tty) ttys.push(processInfo.tty);
    hosts.push(...runtime.processHostLocations(await runtime.readProcessHostEnv(pid)));
    pid = processInfo.parent;
  }
  return { pids, ttys, hosts };
}

async function readTmux(pane: string) {
  if (!/^%\d+$/u.test(pane)) return null;
  const { stdout } = await execSystemFile("tmux", ["display-message", "-p", "-t", pane,
    "#{socket_path}\t#{pane_pid}\t#{pane_tty}\t#{pane_id}\t#{session_name}"], { timeoutMs: 2_000, maxStdoutBytes: 4096 });
  const [socket, pid, tty, actualPane, session] = stdout.trim().split("\t");
  return socket && Number(pid) > 0 && actualPane === pane && session ? { socket, pid: Number(pid), tty: ttyName(tty), pane, session } : null;
}

export function createSessionSteering(overrides: Partial<SessionSteeringDeps> = {}) {
  const loadRuntime = async (): Promise<InPlaceRuntime> => overrides.runtime ?? await import("@openscout/runtime/in-place");
  const deps: Omit<SessionSteeringDeps, "runtime"> = {
    machine: async () => (await readScoutBrokerHealth()).nodeId,
    records: readClaudeSessionRecords, process: readProcess, self: async () => caller(await loadRuntime()),
    herdr: (session) => readHerdrTopology(session, { maxAgeMs: 0 }), tmux: readTmux,
    ...overrides,
  };

  async function bind(ref: string, machine: string | null): Promise<Bound> {
    try {
      const local = await deps.machine();
      if (!local || !machine) return refused("machine_unverified", "The session's machine is not verified.");
      if (machine !== local) return refused("remote_refused", "Direct steering has no verified remote path. Open this session on its machine.");
      const match = /^session:(claude|codex):([A-Za-z0-9_-][A-Za-z0-9._-]{0,199})$/u.exec(ref);
      if (!match) return refused("invalid_session", "An exact Claude or Codex native session reference is required.");
      let runtime: InPlaceRuntime;
      try { runtime = await loadRuntime(); }
      catch { return refused("in_place_unavailable", "This installation does not have the in-place session runtime."); }
      const harness = match[1] as "claude" | "codex", sessionId = match[2]!;
      const records = harness === "claude" ? (await deps.records()).filter((r) => r.sessionId === sessionId) : [];
      if (harness === "codex" && await runtime.codexThreadHeldByChatGPTApp(sessionId)) {
        return refused("native_app_refused", "This thread is held by the native app; no verified process-addressed input path is available.");
      }
      const pids = [...new Set(harness === "claude" ? records.map((r) => r.pid) : await runtime.codexThreadHolderPids(sessionId))];
      const live = (await Promise.all(pids.map(deps.process))).filter((p): p is Process => p !== null);
      if (live.some((p) => records.some((r) => r.pid === p.pid && !r.procStart))) return refused("unverified_process", "A live candidate has no process birth evidence; its session ownership is unverified.");
      const matches = live.filter((p) => harness === "codex" || records.some((r) => r.pid === p.pid && r.procStart && normalize(r.procStart) === normalize(p.start)));
      if (!matches.length) return refused("not_live", "No birth-verified live process holds this session. Nothing will be resumed or started.");
      if (matches.length !== 1) return refused("ambiguous", "More than one live process holds this session.");
      const processInfo = matches[0]!;
      const record = records.find((r) => r.pid === processInfo.pid && r.procStart && normalize(r.procStart) === normalize(processInfo.start)) ?? null;
      if (record && runtime.isScoutBackgroundCopy(record)) return refused("background_copy", "This process is a Scout background copy, not the operator's live session.");
      const own = await deps.self();
      if (own.pids.includes(processInfo.pid) || processInfo.tty && own.ttys.includes(processInfo.tty)) return refused("self_target", "The target is the web server's own process or terminal.");
      if (!processInfo.tty || !processInfo.foreground) return refused("not_foreground", "The session has no verified foreground terminal process.");
      const env = await runtime.readProcessHostEnv(processInfo.pid);
      const host = runtime.innermostProcessHost(env);
      const sameHost = (a: HostLocation, b: HostLocation) => a.host === "herdr" && b.host === "herdr" ? a.session === b.session && a.paneId === b.paneId
        : a.host === "orca" && b.host === "orca" ? a.terminalHandle === b.terminalHandle
        : a.host === "tmux" && b.host === "tmux" && a.pane === b.pane;
      if (host && own.hosts.some((h) => sameHost(h, host))) return refused("self_target", "The target is the web server's own pane.");
      const candidates: Binding[] = [];
      const base = { sessionId, harness, record, host, herdr: null, orca: [] };
      const target = (kind: SessionSteerTarget["host"], address: string): SessionSteerTarget => ({ pid: processInfo.pid, processStart: processInfo.start, host: kind, address, tty: processInfo.tty });
      if (host?.host === "herdr") {
        const topology = await deps.herdr(host.session);
        const panes = topology?.running ? topology.workspaces.flatMap((w) => w.tabs.flatMap((t) => t.panes)).filter((p) => p.agentSession?.value === sessionId) : [];
        if (panes.length !== 1 || panes[0]?.paneId !== host.paneId) return refused("host_unverified", "Herdr does not uniquely confirm this session in its process's pane.", target("herdr", `${host.session}/${host.paneId}`));
        const pane = panes[0]!;
        if (pane.agentStatus === "blocked") return refused("session_blocked", "Answer the session's approval prompt before steering.", target("herdr", `${host.session}/${host.paneId}`));
        candidates.push({ ...base, target: target("herdr", `${host.session}/${host.paneId}`), herdr: { session: host.session, paneId: host.paneId, status: pane.agentStatus } });
      } else if (host?.host === "orca") {
        const agents = (await runtime.readOrcaAgents()).filter((a) => a.paneKey === host.paneKey);
        if (!host.paneKey || agents.length !== 1) return refused("host_unverified", "Orca does not uniquely confirm the process's terminal.", target("orca", host.terminalHandle));
        if (["blocked", "waiting", "unknown"].includes(agents[0]!.state)) return refused("session_blocked", "Orca cannot accept steering while the session is blocked or unverified.", target("orca", host.terminalHandle));
        candidates.push({ ...base, target: target("orca", host.terminalHandle), orca: agents });
      }
      if (env.TMUX && env.TMUX_PANE) {
        // Runtime sends on the default tmux socket. Prove that it is this
        // process's socket, not a similarly numbered pane on another server.
        const pane = await deps.tmux(env.TMUX_PANE);
        if (!pane || pane.socket !== env.TMUX.split(",")[0] || pane.tty !== processInfo.tty) return refused("tmux_unverified", "The runtime's default tmux socket/pane does not match this process.");
        let ancestor: Process | null = processInfo;
        for (let i = 0; i < 16 && ancestor && ancestor.pid !== pane.pid; i++) ancestor = await deps.process(ancestor.parent);
        if (!ancestor || ancestor.pid !== pane.pid) return refused("tmux_unverified", "The tmux pane does not contain this session's process.");
        if (own.hosts.some((h) => h.host === "tmux" && h.pane === pane.pane)) return refused("self_target", "The target is the web server's own tmux pane.");
        // Codex's in-place API intentionally doesn't dispatch bare tmux ids.
        if (harness === "claude" && record?.tmux?.pane === pane.pane && record.tmux.session === pane.session) candidates.push({ ...base, target: target("tmux", pane.pane) });
      }
      if (!host && !env.TMUX && harness === "claude") candidates.push({ ...base, target: target("terminal", processInfo.tty) });
      const selected = runtime.resolveInPlaceOrder().map((kind) => candidates.find((c) => c.target.host === kind)).find(Boolean);
      return selected ? { available: true, binding: selected } : refused("host_unavailable", "No verified in-place host can type into this process.");
    } catch {
      return refused("probe_failed", "Live process or host verification failed. Nothing was sent.");
    }
  }

  const available = (binding: Binding): SessionSteerAvailability => ({ available: true, code: "ready", reason: `Types into ${binding.target.host} on ${hostname()}.`, target: binding.target });
  const sending = new Set<string>();
  return {
    async inspect(ref: string, machine: string | null): Promise<SessionSteerAvailability> {
      const result = await bind(ref, machine);
      return result.available ? available(result.binding) : result;
    },
    async steer(ref: string, machine: string | null, text: string, beforeDelivery: (target: SessionSteerTarget) => Promise<void>): Promise<SessionSteerAvailability> {
      const key = JSON.stringify([machine, ref]);
      if (sending.has(key)) return refused("busy", "Steering is already in progress for this session.");
      sending.add(key);
      try {
        const first = await bind(ref, machine);
        if (!first.available) return first;
        const current = await bind(ref, machine);
        if (!current.available) return current;
        const binding = current.binding;
        if (JSON.stringify(first.binding.target) !== JSON.stringify(binding.target)) return refused("binding_changed", "The process binding changed. Nothing was sent.", first.binding.target);
        try { await beforeDelivery(binding.target); }
        catch { return refused("audit_unavailable", "The steering intent could not be saved. Nothing was sent.", binding.target); }
        try {
          const runtime = await loadRuntime();
          // The host probes and durable intent can take time. Read ownership
          // again AFTER them, immediately before entering the pinned dispatcher.
          const appNow = binding.harness === "codex" && await runtime.codexThreadHeldByChatGPTApp(binding.sessionId);
          const currentRecords = binding.harness === "claude" ? (await deps.records()).filter((r) => r.sessionId === binding.sessionId) : [];
          const currentPids = [...new Set(binding.harness === "claude" ? currentRecords.map((r) => r.pid) : await runtime.codexThreadHolderPids(binding.sessionId))];
          const otherLive = await Promise.all(currentPids.filter((pid) => pid !== binding.target.pid).map(deps.process));
          const anotherOwner = otherLive.some((p) => p && (binding.harness === "codex" || currentRecords.some((r) => r.pid === p.pid
            && (!r.procStart || normalize(r.procStart) === normalize(p.start)))));
          const stillOwned = !appNow && !anotherOwner && currentPids.includes(binding.target.pid) && (binding.harness === "codex"
            || currentRecords.some((r) => r.pid === binding.target.pid && r.procStart && normalize(r.procStart) === normalize(binding.target.processStart)));
          const processNow = await deps.process(binding.target.pid);
          if (!stillOwned || !processNow || normalize(processNow.start) !== normalize(binding.target.processStart)
            || processNow.tty !== binding.target.tty || !processNow.foreground) {
            return refused("binding_changed", "The process exited or changed before input dispatch. Nothing was sent.", binding.target);
          }
          const result = await runtime.deliverInPlace({ sessionId: binding.sessionId, harness: binding.harness, body: text }, {
            // Restrict EVERY discovery path to the one freshly verified binding.
            // Runtime host failure is final; no fallback, fork, or native app UI.
            findHerdrPane: async () => binding.herdr,
            findClaudeRecord: async () => binding.harness === "claude" ? binding.record : null,
            codexThreadPids: async () => binding.harness === "codex" ? [binding.target.pid] : [],
            locateProcess: async () => binding.host,
            codexHeldByApp: async () => false,
            readOrcaAgents: async () => binding.orca,
            ttyForPid: async () => binding.target.tty,
            selfTty: async () => null, self: [], order: [binding.target.host],
          });
          return result.ok ? { ...available(binding), code: "accepted", reason: "Input accepted by the live host; harness consumption is not confirmed." }
            : refused("delivery_unconfirmed", "Input was not confirmed. Check the live session before trying again.", binding.target);
        } catch {
          // Child-process exceptions can echo argv, including the body. Do not
          // persist or return them, and never retry a potentially accepted send.
          return refused("delivery_unconfirmed", "Input was not confirmed. Check the live session before trying again.", binding.target);
        }
      } finally { sending.delete(key); }
    },
  };
}
export type SessionSteering = ReturnType<typeof createSessionSteering>;
