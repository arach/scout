import { join } from "node:path";
import { recordActivity } from "./activity.js";
import { readHubJson, writePrivateJson } from "./state.js";

export type Rejections = Record<string, { count: number; lastAt: string }>;
export type InboxHealth = {
  ok: boolean; pending?: number; webhooks?: Record<string, boolean>; rejections?: Rejections;
  rejectionBuckets?: Record<string, Record<string, number>>;
};
type Observation = Pick<InboxHealth, "rejections" | "rejectionBuckets"> & {
  inbox: string; at: string; enabledSince: string | null;
};

export function readInboxObservation(home: string, inbox: string | null) {
  const seen = readHubJson<Observation>(join(home, "inbox-health.json"));
  return seen?.inbox === inbox ? seen : null;
}

// Called under the collect lock. Keep the last successful observation across
// transient failures and process restarts. Never persist response headers.
export function observeInbox(home: string, inbox: string, health: InboxHealth, at: string) {
  const previous = readInboxObservation(home, inbox);
  for (const [reason, current] of Object.entries(health.rejections ?? {})) {
    let delta = 0;
    if (previous?.rejectionBuckets && health.rejectionBuckets) {
      for (const [hour, counts] of Object.entries(health.rejectionBuckets)) {
        delta += Math.max(0, (counts[reason] ?? 0) - (previous.rejectionBuckets[hour]?.[reason] ?? 0));
      }
    } else {
      const old = previous?.rejections?.[reason];
      delta = old ? Math.max(current.count - old.count, current.lastAt > old.lastAt ? 1 : 0) : current.count;
    }
    if (delta) recordActivity("rejection", `${reason}: ${delta} refused (latest ${current.lastAt})`, home);
  }
  writePrivateJson(join(home, "inbox-health.json"), {
    inbox, at, enabledSince: health.webhooks?.anthropic ? previous?.enabledSince ?? at : null,
    rejections: health.rejections ?? {}, rejectionBuckets: health.rejectionBuckets,
  } satisfies Observation);
}
