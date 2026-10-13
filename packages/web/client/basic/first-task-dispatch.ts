/** Poll only while mounted and unresolved. Projection may lag a terminal flight. */
type Attempt = { id: string; messageId?: string | null };
export type FirstTaskDispatchSnapshot = {
  attempts: readonly Attempt[];
  failedDeliveries: readonly Attempt[];
  failedQueries: readonly Attempt[];
};

type Scheduler = {
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
};
const timers: Scheduler = {
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function watchFirstTaskDispatch(
  messageId: string,
  read: (signal: AbortSignal) => Promise<FirstTaskDispatchSnapshot>,
  onFound: (attemptId: string) => void,
  scheduler: Scheduler = timers,
): () => void {
  const abort = new AbortController();
  let stopped = false;
  let timer: unknown;
  const stop = () => {
    stopped = true;
    if (timer !== undefined) scheduler.cancel(timer);
    timer = undefined;
    abort.abort();
  };
  const lookup = async () => {
    timer = undefined;
    try {
      // At most one request, with a bounded timeout; never accumulate overlaps.
      const snapshot = await read(AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]));
      if (stopped) return;
      const match = [...snapshot.attempts, ...snapshot.failedDeliveries, ...snapshot.failedQueries]
        .find((attempt) => attempt.messageId === messageId);
      if (match) {
        stop();
        onFound(match.id);
        return;
      }
    } catch {
      // Temporary broker failure is not proof that the exact row cannot arrive.
    }
    if (!stopped) timer = scheduler.schedule(() => { void lookup(); }, 2_500);
  };
  void lookup();
  return stop;
}
