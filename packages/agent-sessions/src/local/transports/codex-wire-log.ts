import { appendFile } from "node:fs/promises";

type Entry = { path: string; text: string; bytes: number };

/** Ordered observational logs. Backpressure bounds the working buffer without
 * discarding context. The current input chunk can exceed the high-water mark. */
export class CodexWireLog {
  private readonly queue: Entry[] = [];
  private bytes = 0;
  private pumping: Promise<void> | null = null;
  private failure: Error | null = null;
  private paused = false;

  constructor(private readonly options: {
    setPaused(paused: boolean): void;
    onError(error: Error): void;
    append?: (path: string, text: string) => Promise<unknown>;
    highWaterBytes?: number;
    lowWaterBytes?: number;
    maxBufferedEntries?: number;
  }) {}

  get bufferedBytes(): number { return this.bytes; }
  get bufferedEntries(): number { return this.queue.length; }
  get isPaused(): boolean { return this.paused; }

  append(path: string, text: string): void {
    if (!text) return;
    const bytes = Buffer.byteLength(text);
    this.queue.push({ path, text, bytes });
    this.bytes += bytes;
    if (this.bytes >= (this.options.highWaterBytes ?? 1_048_576)
      || this.queue.length >= (this.options.maxBufferedEntries ?? 1024)) this.pause(true);
    if (!this.pumping && !this.failure) {
      // One pump, regardless of the number of lines; no per-line promise chain.
      this.startPump();
    }
  }

  async flush(): Promise<void> {
    // Input may append while a previous batch finishes.
    while (this.pumping) await this.pumping;
    if (this.failure) throw this.failure;
  }

  private pause(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.options.setPaused(paused);
  }

  private startPump(): void {
    this.pumping = this.drain().finally(() => {
      this.pumping = null;
      if (this.queue.length && !this.failure) this.startPump();
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const first = this.queue[0]!;
      let count = 1;
      let bytes = first.bytes;
      while (count < this.queue.length && bytes < 131_072 && this.queue[count]!.path === first.path) {
        bytes += this.queue[count]!.bytes;
        count += 1;
      }
      const text = count === 1 ? first.text : this.queue.slice(0, count).map((entry) => entry.text).join("");
      try {
        await (this.options.append ?? appendFile)(first.path, text);
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
        // An append error may have partially written. Do not blindly replay or
        // discard the batch. Keep it for inspection and stop accepting input.
        this.pause(true);
        this.options.onError(this.failure);
        return;
      }
      this.queue.splice(0, count);
      this.bytes -= bytes;
      if (this.bytes <= (this.options.lowWaterBytes ?? 262_144)
        && this.queue.length < (this.options.maxBufferedEntries ?? 1024)) this.pause(false);
    }
  }
}
