import { emptyHistoryRotationPlan, type HistoryRotationPlan } from "./history-rotation.js";
import type { HistoricalPublication } from "./control-plane-history-store.js";
import type { HistoricalRelocationPublication } from "./control-plane-history-relocation.js";

/** Publish every selected record before authorizing its bounded eviction.
 * Each worker call owns a bounded page; a failed/blocked page leaves its source
 * live. The coordinator's final version/dependency check decides eviction.
 */
export async function publishHistoryRotationPages(
  plan: HistoryRotationPlan,
  publish: (remaining: HistoryRotationPlan) => Promise<HistoricalRelocationPublication>,
): Promise<{ published: HistoryRotationPlan; publications: HistoricalPublication[]; blocked: HistoricalRelocationPublication["blocked"] }> {
  const remaining = emptyHistoryRotationPlan();
  const published = emptyHistoryRotationPlan();
  const keys = Object.keys(plan) as (keyof HistoryRotationPlan)[];
  for (const key of keys) remaining[key] = new Set(plan[key]);
  const publications: HistoricalPublication[] = [];
  let blocked: HistoricalRelocationPublication["blocked"] = [];
  while (keys.some(key => remaining[key].size > 0)) {
    const page = await publish(remaining);
    blocked = page.blocked;
    let progress = 0;
    if (page.publication) {
      publications.push(page.publication);
      for (const key of keys) for (const id of page.published[key]) {
        if (remaining[key].delete(id)) { published[key].add(id); progress++; }
      }
    }
    if (!progress) break;
  }
  return { published, publications, blocked };
}
