/** Admission control for read-only UI polls. Never use this for commands. */
export class PollingReadUnavailable extends Error {
  constructor(readonly retryAfterMs: number, cause?: unknown) {
    super("This view is temporarily unavailable. Retry shortly.", { cause });
  }
}

type Entry<T> = {
  value?: { data: T; expiresAt: number };
  pending: Promise<T> | null;
  failures: number;
  retryAt: number;
  generation: number;
};

export function createPollingReadCache<T>(options: {
  ttlMs: number;
  maxEntries?: number;
  maxConcurrent?: number;
  now?: () => number;
  random?: () => number;
}) {
  const entries = new Map<string, Entry<T>>();
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const maxEntries = options.maxEntries ?? 32;
  const maxConcurrent = options.maxConcurrent ?? 4;
  let active = 0;

  function get(key: string, load: () => Promise<T> | T): Promise<T> {
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= maxEntries) {
        // Never evict unfinished work or a failure cooldown: eviction would
        // allow a new request to start the same expensive operation again.
        const idle = [...entries].find(([, item]) => !item.pending && item.retryAt <= now());
        if (!idle) return Promise.reject(new PollingReadUnavailable(1_000));
        entries.delete(idle[0]);
      }
      entry = { pending: null, failures: 0, retryAt: 0, generation: 0 };
      entries.set(key, entry);
    }
    if (entry.pending) return entry.pending;
    if (entry.value && now() < entry.value.expiresAt) return Promise.resolve(entry.value.data);
    if (now() < entry.retryAt) return Promise.reject(new PollingReadUnavailable(entry.retryAt - now()));
    if (active >= maxConcurrent) return Promise.reject(new PollingReadUnavailable(1_000));

    const current = entry;
    const generation = current.generation;
    active += 1;
    // Install the promise before invoking load, including synchronously throwing
    // SQLite reads. The TTL starts at completion, never at request admission.
    current.pending = Promise.resolve().then(load).then((data) => {
      if (current.generation === generation) current.value = { data, expiresAt: now() + options.ttlMs };
      current.failures = 0;
      current.retryAt = 0;
      return data;
    }, (cause: unknown) => {
      current.failures += 1;
      const base = Math.min(30_000, 1_000 * 2 ** Math.min(current.failures - 1, 5));
      const delay = Math.min(30_000, Math.round(base * (0.8 + random() * 0.4)));
      current.retryAt = now() + delay;
      throw new PollingReadUnavailable(delay, cause);
    }).finally(() => {
      current.pending = null;
      active -= 1;
    });
    return current.pending;
  }

  return {
    get,
    invalidate(key: string) {
      const entry = entries.get(key);
      if (!entry) return;
      entry.generation += 1;
      entry.value = undefined;
      // Preserve pending work and cooldowns. A command must not multiply reads
      // or let a pre-command snapshot repopulate the response cache.
    },
  };
}

/** Keep failures retryable without leaking SQL, paths or exception details. */
export function pollingReadFailureResponse(error: unknown): Response {
  if (!(error instanceof PollingReadUnavailable)) throw error;
  const retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterMs / 1_000));
  return Response.json({ error: "view_temporarily_unavailable", retryAfterSeconds }, {
    status: 503,
    headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" },
  });
}
