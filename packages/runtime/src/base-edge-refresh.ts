/** Base-private, single-flight host refresh. Snapshot ownership before the
 * lookup and check it again before any synchronous configuration/effects. */
export function createBaseEdgeRefresh<Owner>(options: {
  current(): { generation: number; owner: Owner } | null;
  readHosts(): Promise<string[]>;
  apply(hosts: string[]): void;
}): { refresh(): Promise<void> } {
  let inFlight: Promise<void> | undefined;
  return {
    refresh() {
      if (inFlight) return inFlight;
      const captured = options.current();
      if (!captured) return Promise.resolve();
      const work = (async () => {
        const hosts = await options.readHosts();
        const current = options.current();
        if (
          !current ||
          current.generation !== captured.generation ||
          current.owner !== captured.owner
        )
          return;
        options.apply(hosts);
      })();
      inFlight = work.finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    },
  };
}
