import { refuse } from "./contracts.js";

export type ChildSignalResult = "signal_requested" | "already_exited" | "wait_error";
export type ChildExit = { code: number | null; signal: string | number | null };
/** Internal seam for deterministic reap-window tests. Never an adoption API. */
export interface OwnedChildHandle {
  readonly pid: number;
  readonly exitCode: number | null;
  readonly signalCode: string | number | null;
  readonly exited: Promise<number>;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}
/** Only the audited Darwin event-loop reaper may supply this handle. A Linux
 * waiter thread can reap before publishing status; this wrapper cannot fix it. */
export class RetainedChild {
  private readonly result: Promise<ChildExit | undefined>;
  private settled = false;
  private failed = false;
  private observed?: ChildExit;
  constructor(private readonly handle: OwnedChildHandle, private readonly waitError: () => boolean = () => false) {
    this.result = handle.exited.then(() => {
      this.settled = true;
      const code = handle.exitCode, signal = handle.signalCode;
      if (code !== null && Number.isInteger(code) && code >= 0 && code <= 255 && signal === null) return this.observed = { code, signal };
      if (code === null && (typeof signal === "string" && /^SIG[A-Z0-9]+$/.test(signal)
        || typeof signal === "number" && Number.isInteger(signal) && signal > 0)) return this.observed = { code, signal };
      this.failed = true;
      return undefined; // A wait error is not an exit proof.
    }, () => { this.settled = true; this.failed = true; return undefined; });
  }
  signal(signal: "SIGTERM" | "SIGKILL"): ChildSignalResult {
    if (signal !== "SIGTERM" && signal !== "SIGKILL") refuse("invalid_child_signal");
    if (this.failed || this.waitError()) return "wait_error";
    // No await between the status check and the handle call. On the audited
    // backend, JS cannot run between wait4 and publication of terminal status.
    if (this.settled || this.handle.exitCode !== null || this.handle.signalCode !== null) return "already_exited" as const;
    this.handle.kill(signal);
    // Bun returns void, not a delivery acknowledgment. In particular native
    // terminal/error statuses make kill inert; never claim a signal was sent.
    return "signal_requested";
  }
  async exit(): Promise<ChildExit> {
    const result = await this.result;
    if (!result) refuse("child_exit_unproven");
    return { ...result };
  }
  /** Nonblocking exact-handle observation; no wait, signal or PID lookup. */
  pollExit(): ChildExit | undefined {
    if (this.failed || this.waitError()) refuse("child_exit_unproven");
    return this.observed && { ...this.observed };
  }
}
