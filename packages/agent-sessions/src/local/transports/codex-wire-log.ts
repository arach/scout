import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

type Entry = { path: string; text: string; bytes: number; at: string };
type Gap = { schema: "scout.codex-wire-log-gap/v1"; id: string; entries: number; bytes: number;
  firstAt: string; lastAt: string; error: string; partialWritePossible: boolean };
export const CODEX_WIRE_LOG_GAP_PREFIX = "[scout.codex-wire-log-gap/v1] ";

/** Ordered observational logs, never a control-path durability barrier.
 * The current input chunk may exceed the high-water mark before its pause takes effect.
 * Healthy sinks exert high/low-water backpressure. Failed appends are NOT replayed:
 * discard payloads and retain gap counters per sink (the transport has two fixed paths).
 * A failed append can leave an arbitrary prefix, so counts cover at-risk entries/bytes,
 * not a claim about exactly how many bytes reached disk. Recovery starts on a new line.
 */
export class CodexWireLog {
  private readonly queue: Entry[] = [];
  private readonly gaps = new Map<string, Gap>();
  private marker: { path: string; gap: Gap } | null = null;
  private bytes = 0;
  private pumping: Promise<void> | null = null;
  private degraded = false;
  private paused = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retriesEnabled = true;
  private lostEntries = 0;
  private lostBytes = 0;
  private errorCode = "Error";

  constructor(private readonly options: {
    setPaused(paused: boolean): void;
    onError(error: Error): void;
    append?: (path: string, text: string) => Promise<unknown>;
    highWaterBytes?: number;
    lowWaterBytes?: number;
    maxBufferedEntries?: number;
    retryMs?: number;
    now?: () => number;
  }) {}

  get bufferedBytes(): number { return this.bytes; }
  get bufferedEntries(): number { return this.queue.length; }
  get isPaused(): boolean { return this.paused; }
  get droppedEntries(): number { return this.lostEntries; }
  get droppedBytes(): number { return this.lostBytes; }

  append(path: string, text: string): void {
    if (!text) return;
    const entry = { path, text, bytes: Buffer.byteLength(text), at: new Date((this.options.now ?? Date.now)()).toISOString() };
    if (this.degraded) { this.drop(entry, false); this.scheduleRetry(); return; }
    this.queue.push(entry); this.bytes += entry.bytes;
    if (this.bytes >= (this.options.highWaterBytes ?? 1_048_576)
      || this.queue.length >= (this.options.maxBufferedEntries ?? 1024)) this.pause(true);
    if (!this.pumping) this.startPump();
  }

  /** One bounded recovery attempt, not an indefinite wait for disk space. */
  async flush(): Promise<void> {
    while (this.pumping) await this.pumping;
    if (this.degraded) {
      this.clearRetry(); this.startPump();
      while (this.pumping) await this.pumping;
    }
  }

  /** Stop background retries for disconnected sessions; reconnect resumes them. */
  setActive(active: boolean): void {
    this.retriesEnabled = active;
    if (!active) this.clearRetry(); else if (this.degraded) this.scheduleRetry();
  }

  private pause(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused; this.options.setPaused(paused);
  }
  private clearRetry(): void { if (this.retryTimer) clearTimeout(this.retryTimer); this.retryTimer = null; }
  private scheduleRetry(): void {
    if (!this.retriesEnabled || this.retryTimer || this.pumping) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (!this.pumping) this.startPump(); }, this.options.retryMs ?? 1000);
    this.retryTimer.unref?.();
  }
  private drop(entry: Entry, partial: boolean): void {
    let gap = this.gaps.get(entry.path);
    if (!gap) {
      gap = { schema: "scout.codex-wire-log-gap/v1", id: randomUUID(), entries: 0, bytes: 0,
        firstAt: entry.at, lastAt: entry.at, error: this.errorCode, partialWritePossible: false };
      this.gaps.set(entry.path, gap);
    }
    gap.entries++; gap.bytes += entry.bytes; gap.firstAt = gap.firstAt < entry.at ? gap.firstAt : entry.at; gap.lastAt = gap.lastAt > entry.at ? gap.lastAt : entry.at; gap.partialWritePossible ||= partial;
    this.lostEntries++; this.lostBytes += entry.bytes;
  }
  private failed(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.errorCode = String((failure as NodeJS.ErrnoException).code ?? failure.name).slice(0, 64);
    const firstFailure = !this.degraded;
    this.degraded = true;
    // A transient disk failure must RELEASE healthy high-water backpressure too.
    this.pause(false);
    if (firstFailure) { try { this.options.onError(failure); } catch { /* The diagnostic sink may also be full. */ } }
  }
  private startPump(): void {
    this.pumping = this.drain().finally(() => {
      this.pumping = null;
      if (this.degraded) this.scheduleRetry();
      else if (this.queue.length) this.startPump();
    });
  }
  private async drain(): Promise<void> {
    const append = this.options.append ?? appendFile;
    // Retain one frozen marker across uncertain marker writes. Same ID/body permits
    // deduplication if a full marker reached disk before an append reported failure.
    while (this.degraded) {
      if (!this.marker) {
        const next = this.gaps.entries().next().value as [string, Gap] | undefined;
        if (!next) { this.degraded = false; break; }
        this.gaps.delete(next[0]); this.marker = { path: next[0], gap: next[1] };
      }
      try { await append(this.marker.path, `\n${CODEX_WIRE_LOG_GAP_PREFIX}${JSON.stringify(this.marker.gap)}\n`); }
      catch (error) { this.failed(error); return; }
      this.marker = null;
    }
    while (this.queue.length) {
      const first = this.queue[0]!;
      let count = 1, bytes = first.bytes;
      while (count < this.queue.length && bytes < 131_072 && this.queue[count]!.path === first.path) { bytes += this.queue[count]!.bytes; count++; }
      const text = this.queue.slice(0, count).map(entry => entry.text).join("");
      try { await append(first.path, text); }
      catch (error) {
        this.failed(error);
        for (let index = 0; index < this.queue.length; index++) this.drop(this.queue[index]!, index < count);
        this.queue.length = 0; this.bytes = 0;
        return;
      }
      this.queue.splice(0, count); this.bytes -= bytes;
      if (this.bytes <= (this.options.lowWaterBytes ?? 262_144)
        && this.queue.length < (this.options.maxBufferedEntries ?? 1024)) this.pause(false);
    }
  }
}
