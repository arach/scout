export function coalesce<T>(fn: () => Promise<T>, ttlMs = 2000): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  let cached: { value: T; expiresAt: number } | null = null;

  return () => {
    if (cached && Date.now() < cached.expiresAt) {
      return Promise.resolve(cached.value);
    }
    if (inflight) {
      return inflight;
    }

    inflight = fn()
      .then((value) => {
        cached = { value, expiresAt: Date.now() + ttlMs };
        inflight = null;
        return value;
      })
      .catch((error) => {
        inflight = null;
        throw error;
      });

    return inflight;
  };
}
