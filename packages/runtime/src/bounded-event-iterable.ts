/** A slow subscriber must resnapshot instead of retaining unbounded history. */
export class StreamResyncRequired extends Error {
  readonly code = "resync_required";
  constructor(readonly lastDeliveredId?: string) {
    super(`Stream consumer fell behind; resnapshot before reconnecting${lastDeliveredId ? ` (last delivered: ${lastDeliveredId})` : ""}.`);
    this.name = "StreamResyncRequired";
  }
}

export function boundedEventIterable<T>(options: {
  subscribe: (listener: (event: T) => void) => () => void;
  signal?: AbortSignal;
  accepts?: (event: T) => boolean;
  id?: (event: T) => string;
  maxCount?: number;
  maxBytes?: number;
  maxAgeMs?: number;
}): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const queue: { event: T; bytes: number; at: number }[] = [];
      const maxCount = options.maxCount ?? 256;
      const maxBytes = options.maxBytes ?? 1024 * 1024;
      const maxAgeMs = options.maxAgeMs ?? 30_000;
      let bytes = 0;
      let done = false;
      let failure: StreamResyncRequired | undefined;
      let lastDeliveredId: string | undefined;
      let wake: (() => void) | undefined;
      let unsubscribe: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        done = true;
        unsubscribe?.();
        unsubscribe = undefined;
        options.signal?.removeEventListener("abort", cleanup);
        if (timer) clearTimeout(timer);
        timer = undefined;
        queue.length = 0;
        bytes = 0;
        wake?.();
        wake = undefined;
      };
      const overflow = () => { failure = new StreamResyncRequired(lastDeliveredId); cleanup(); };
      const armAgeLimit = () => {
        if (timer) clearTimeout(timer);
        timer = queue.length ? setTimeout(overflow, Math.max(1, queue[0].at + maxAgeMs - Date.now())) : undefined;
        timer?.unref?.();
      };
      unsubscribe = options.subscribe(event => {
        if (done || (options.accepts && !options.accepts(event))) return;
        const size = Buffer.byteLength(JSON.stringify(event));
        if (queue.length >= maxCount || bytes + size > maxBytes
          || (queue[0] && Date.now() - queue[0].at >= maxAgeMs)) { overflow(); return; }
        queue.push({ event, bytes: size, at: Date.now() });
        bytes += size;
        if (queue.length === 1) armAgeLimit();
        wake?.();
        wake = undefined;
      });
      // A subscription implementation can synchronously publish on attach.
      if (done) { unsubscribe(); unsubscribe = undefined; }
      if (options.signal?.aborted) cleanup();
      else options.signal?.addEventListener("abort", cleanup, { once: true });
      return {
        async next(): Promise<IteratorResult<T>> {
          for (;;) {
            if (failure) throw failure;
            if (done) return { done: true, value: undefined };
            const item = queue.shift();
            if (item) {
              bytes -= item.bytes;
              armAgeLimit();
              lastDeliveredId = options.id?.(item.event);
              return { done: false, value: item.event };
            }
            await new Promise<void>(resolve => { wake = resolve; });
          }
        },
        async return(): Promise<IteratorResult<T>> { cleanup(); return { done: true, value: undefined }; },
      };
    },
  };
}
