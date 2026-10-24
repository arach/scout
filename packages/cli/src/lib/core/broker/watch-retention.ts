/** Watchers retain correlation identifiers, never canonical message bodies. */
export const WATCH_REFERENCE_LIMIT = 1024;
export const WATCH_REFERENCE_CHARACTER_LIMIT = 128 * 1024;
// The runtime permits 64 MiB SSE frames. UTF-8 has at least one byte per
// character, so this accepts every legal frame while bounding malformed input.
export const WATCH_FRAME_CHARACTER_LIMIT = 64 * 1024 * 1024;

export class WatchReferenceCache<T extends { id: string }> {
  private readonly entries = new Map<string, { value: T; characters: number }>();
  private characters = 0;

  get(id: string): T | undefined {
    return this.entries.get(id)?.value;
  }

  set(value: T): void {
    const previous = this.entries.get(value.id);
    if (previous) {
      this.characters -= previous.characters;
      this.entries.delete(value.id);
    }
    const characters = value.id.length + Object.values(value).reduce<number>(
      (sum, field) => sum + (typeof field === "string" ? field.length : 0), 0,
    );
    if (characters > WATCH_REFERENCE_CHARACTER_LIMIT) return;
    this.entries.set(value.id, { value, characters });
    this.characters += characters;
    while (this.entries.size > WATCH_REFERENCE_LIMIT || this.characters > WATCH_REFERENCE_CHARACTER_LIMIT) {
      const oldest = this.entries.keys().next().value!;
      this.characters -= this.entries.get(oldest)!.characters;
      this.entries.delete(oldest);
    }
  }
}

/** Bound each frame, not a read: one network read may contain many frames. */
export class WatchFrameAccumulator {
  private buffer = "";
  private searchOffset = 0;

  constructor(private readonly limit = WATCH_FRAME_CHARACTER_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1 || limit > WATCH_FRAME_CHARACTER_LIMIT) throw Error("invalid watch frame limit");
  }

  *push(text: string): Generator<string> {
    for (let offset = 0; offset < text.length; offset += 64 * 1024) {
      this.buffer += text.slice(offset, offset + 64 * 1024);
      let delimiter: number;
      while ((delimiter = this.buffer.indexOf("\n\n", this.searchOffset)) !== -1) {
        if (delimiter > this.limit) this.tooLarge();
        const block = this.buffer.slice(0, delimiter);
        this.buffer = this.buffer.slice(delimiter + 2);
        this.searchOffset = 0;
        yield block;
      }
      this.searchOffset = Math.max(0, this.buffer.length - 1);
      if (this.buffer.length > this.limit + 1) this.tooLarge();
    }
  }

  private tooLarge(): never {
    this.buffer = "";
    this.searchOffset = 0;
    throw new Error("Scout watch SSE frame exceeds the 64 MiB character limit");
  }
}
