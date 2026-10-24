// Keeps this host from idle-sleeping while its agents work.
//
// A host that sleeps mid-task drops off the relay: the phone or browser that
// asked for the work can't see it finish, and the agent stops. While any agent
// on this host is working, the runtime holds `caffeinate -i`, which blocks idle
// sleep but not the display going dark or a lid closing. Once the work ends the
// hold lasts a grace period longer, so the person who reads the result can
// answer before the host drops away. `-w <pid>` ties the hold to the runtime,
// so a runtime that dies, even by SIGKILL, never leaves the host awake.

import { spawn } from "node:child_process";
import type { AgentEndpoint, ObservedActivity, PresenceBeat } from "@openscout/protocol";

/** How long the hold outlasts the work, for the follow-up that comes after it. */
export const HOST_KEEP_AWAKE_GRACE_MS = 10 * 60_000;

/**
 * Activities that mean an agent is mid-task. Waiting on another agent counts:
 * the reply has to land somewhere awake. Waiting on a person does not; the
 * grace period covers a quick answer, and a host shouldn't stay up all night
 * for a question nobody saw.
 */
const WORKING_ACTIVITIES: ReadonlySet<ObservedActivity> = new Set([
  "queued",
  "waking",
  "thinking",
  "executing",
  "working",
  "waiting_on_actor",
]);

export function isWorkingActivity(activity: ObservedActivity): boolean {
  return WORKING_ACTIVITIES.has(activity);
}

/** Agents with an endpoint on this node whose presence says they're mid-task. */
export function countWorkingLocalAgents(
  beats: ReadonlyArray<Pick<PresenceBeat, "agentId" | "activity" | "staleAt">>,
  endpoints: Readonly<Record<string, Pick<AgentEndpoint, "agentId" | "nodeId">>>,
  nodeId: string,
  now: number,
): number {
  const local = new Set<string>();
  for (const endpoint of Object.values(endpoints)) {
    if (endpoint.nodeId === nodeId) local.add(endpoint.agentId);
  }
  let working = 0;
  for (const beat of beats) {
    if (beat.staleAt > now && isWorkingActivity(beat.activity) && local.has(beat.agentId)) working += 1;
  }
  return working;
}

export interface KeepAwakeHold {
  release(): void;
  /** Called once when the hold ends by itself (caffeinate exited or failed to start). */
  onEnd(listener: () => void): void;
}

export interface HostKeepAwakeOptions {
  graceMs?: number;
  now?: () => number;
  acquire?: () => KeepAwakeHold;
  log?: (message: string) => void;
}

export class HostKeepAwake {
  private hold: KeepAwakeHold | null = null;
  private lastWorkingAt = 0;
  private readonly graceMs: number;
  private readonly now: () => number;
  private readonly acquire: () => KeepAwakeHold;
  private readonly log: (message: string) => void;

  constructor(options: HostKeepAwakeOptions = {}) {
    this.graceMs = options.graceMs ?? HOST_KEEP_AWAKE_GRACE_MS;
    this.now = options.now ?? Date.now;
    this.acquire = options.acquire ?? acquireCaffeinate;
    this.log = options.log ?? (() => undefined);
  }

  get holding(): boolean {
    return this.hold !== null;
  }

  /** Feed the number of agents on this host that are working right now. */
  update(workingAgents: number): void {
    const now = this.now();
    if (workingAgents > 0) {
      this.lastWorkingAt = now;
      if (!this.hold) this.take(workingAgents);
      return;
    }
    if (this.hold && now - this.lastWorkingAt >= this.graceMs) {
      this.log(`letting host sleep: no agent has worked for ${Math.round(this.graceMs / 60_000)}m`);
      this.drop();
    }
  }

  stop(): void {
    this.drop();
  }

  private take(workingAgents: number): void {
    const hold = this.acquire();
    this.hold = hold;
    // A hold that ends by itself is retaken on the next update that sees work.
    hold.onEnd(() => {
      if (this.hold === hold) this.hold = null;
    });
    this.log(`keeping host awake: ${workingAgents === 1 ? "an agent is" : `${workingAgents} agents are`} working`);
  }

  private drop(): void {
    const hold = this.hold;
    this.hold = null;
    hold?.release();
  }
}

function acquireCaffeinate(): KeepAwakeHold {
  const listeners: Array<() => void> = [];
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    for (const listener of listeners) listener();
  };
  const child = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  child.on("exit", end);
  child.on("error", end);
  child.unref();
  return {
    release: () => {
      if (!ended) child.kill("SIGTERM");
    },
    onEnd: (listener) => {
      if (ended) listener();
      else listeners.push(listener);
    },
  };
}

/** Off on hosts without caffeinate, or when OPENSCOUT_KEEP_AWAKE=0. */
export function hostKeepAwakeEnabled(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
  return platform === "darwin" && env.OPENSCOUT_KEEP_AWAKE !== "0";
}

export function hostKeepAwakeGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.OPENSCOUT_KEEP_AWAKE_GRACE_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : HOST_KEEP_AWAKE_GRACE_MS;
}
