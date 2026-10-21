import { StreamResyncRequired } from "../bounded-event-iterable.js";
import type { TailEvent } from "./types.js";

/** Runtime-private publication position. Never sent over a transport. */
export type TailPublication = {
  readonly ordinal: number;
  readonly event: TailEvent;
};
export type TailReplayImage = {
  readonly entries: readonly TailPublication[];
  readonly watermark: number;
};
export type TailReplayCapture = {
  readonly image: TailReplayImage;
  readonly live: AsyncIterator<TailPublication>;
  /** Throws sticky failure even while the outer generator is replaying. */
  check(): boolean;
  close(): void;
};
type CaptureOptions = {
  limit: number;
  signal?: AbortSignal;
  accepts?: (event: TailEvent) => boolean;
  onClose?: () => void;
  maxCount?: number;
  maxBytes?: number;
  maxAgeMs?: number;
};

/** One bounded aggregate image and its post-coalescing publication stream.
 * Internal-only: not exported from @openscout/runtime/tail. */
export class TailReplayBuffer {
  private readonly entries: TailPublication[] = [];
  private readonly listeners = new Set<CaptureQueue>();
  private exhausted = false;

  constructor(
    private readonly capacity: number,
    private ordinal = 0,
  ) {
    if (
      !Number.isSafeInteger(capacity) ||
      capacity < 1 ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0
    )
      throw new RangeError("Invalid tail publication buffer.");
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  publish(event: TailEvent): boolean {
    if (this.exhausted) return false;
    if (this.ordinal === Number.MAX_SAFE_INTEGER) {
      this.exhausted = true;
      for (const listener of [...this.listeners]) listener.fail();
      return false;
    }
    const publication = { ordinal: ++this.ordinal, event };
    this.entries.push(publication);
    if (this.entries.length > this.capacity)
      this.entries.splice(0, this.entries.length - this.capacity);
    // Before arbitrary legacy callbacks, from the same public commit path.
    for (const listener of [...this.listeners]) listener.push(publication);
    return true;
  }

  snapshot(limit: number): TailReplayImage {
    const entries = this.entries.slice(-limit);
    // The watermark belongs to this exact ring image, not a later head read.
    return { entries, watermark: entries.at(-1)?.ordinal ?? this.ordinal };
  }

  recent(limit: number): TailEvent[] {
    return this.snapshot(limit).entries.map((item) => item.event);
  }

  attach(options: CaptureOptions): TailReplayCapture {
    const queue = new CaptureQueue(options, () => {
      this.listeners.delete(queue);
      options.onClose?.();
    });
    if (options.signal?.aborted)
      return {
        image: { entries: [], watermark: this.ordinal },
        live: queue,
        check: () => queue.check(),
        close: () => queue.close(),
      };
    this.listeners.add(queue);
    try {
      if (this.exhausted) queue.fail();
      const image = this.snapshot(options.limit);
      queue.setWatermark(image.watermark);
      queue.check();
      return {
        image,
        live: queue,
        check: () => queue.check(),
        close: () => queue.close(),
      };
    } catch (error) {
      queue.close();
      throw error;
    }
  }

  /** A destroyed buffer incarnation invalidates streams; positions never wrap. */
  reset(): void {
    for (const listener of [...this.listeners]) listener.fail();
    this.entries.length = 0;
  }
}

/** One queue covers the entire replay/live lifetime, including pre-watermark
 * synchronous publications. Failure is terminal, never cleared by overlap. */
class CaptureQueue implements AsyncIterator<TailPublication> {
  private readonly queue: {
    item: TailPublication;
    bytes: number;
    at: number;
  }[] = [];
  private bytes = 0;
  private done = false;
  private failure: StreamResyncRequired | undefined;
  private watermark: number | undefined;
  private wake: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly abort = () => this.close();

  constructor(
    private readonly options: CaptureOptions,
    private readonly release: () => void,
  ) {
    // Pre-abort is handled by attach without ever registering a listener.
    if (options.signal?.aborted) this.done = true;
    else options.signal?.addEventListener("abort", this.abort, { once: true });
  }

  check(): boolean {
    if (
      !this.failure &&
      !this.done &&
      this.queue[0] &&
      Date.now() - this.queue[0].at >= (this.options.maxAgeMs ?? 30_000)
    )
      this.fail();
    if (this.failure) throw this.failure;
    return !this.done;
  }

  setWatermark(watermark: number): void {
    this.watermark = watermark;
    // Pending attach work is bounded before W exists too; never erase failure.
    while (this.queue[0] && this.queue[0].item.ordinal <= watermark)
      this.bytes -= this.queue.shift()!.bytes;
    this.armAge();
  }

  push(item: TailPublication): void {
    if (
      this.done ||
      (this.watermark !== undefined && item.ordinal <= this.watermark)
    )
      return;
    try {
      if (this.options.accepts && !this.options.accepts(item.event)) return;
      const bytes = Buffer.byteLength(JSON.stringify(item.event));
      if (
        this.queue.length >= (this.options.maxCount ?? 256) ||
        this.bytes + bytes > (this.options.maxBytes ?? 1024 * 1024) ||
        (this.queue[0] &&
          Date.now() - this.queue[0].at >= (this.options.maxAgeMs ?? 30_000))
      ) {
        this.fail();
        return;
      }
      this.queue.push({ item, bytes, at: Date.now() });
      this.bytes += bytes;
      if (this.queue.length === 1) this.armAge();
      this.wake?.();
      this.wake = undefined;
    } catch {
      this.fail();
    } // Never let the publisher swallow a healthy-looking loss.
  }

  fail(): void {
    if (this.done) return;
    this.failure = new StreamResyncRequired();
    this.close();
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.options.signal?.removeEventListener("abort", this.abort);
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue.length = 0;
    this.bytes = 0;
    this.wake?.();
    this.wake = undefined;
    this.release();
  }

  private armAge(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer =
      !this.done && this.queue.length
        ? setTimeout(
            () => this.fail(),
            Math.max(
              1,
              this.queue[0].at + (this.options.maxAgeMs ?? 30_000) - Date.now(),
            ),
          )
        : undefined;
    this.timer?.unref?.();
  }

  async next(): Promise<IteratorResult<TailPublication>> {
    for (;;) {
      if (!this.check()) return { done: true, value: undefined };
      const item = this.queue.shift();
      if (item) {
        this.bytes -= item.bytes;
        this.armAge();
        return { done: false, value: item.item };
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  async return(): Promise<IteratorResult<TailPublication>> {
    this.close();
    return { done: true, value: undefined };
  }
}
