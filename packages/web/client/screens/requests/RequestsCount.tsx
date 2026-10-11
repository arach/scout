import { requestsCountState } from "./requests-model.ts";

/** Shared expanded/collapsed/page count: only a positive real count gets signal. */
export function RequestsCount({ count, pending = false, navigation = false }: { count: number; pending?: boolean; navigation?: boolean }) {
  const badge = requestsCountState(count);
  return <span className={`scout-requests-count${navigation ? " scout-requests-nav-count" : ""}`}
    data-attention={badge.attention ? "true" : "false"}>{pending ? "—" : badge.count}</span>;
}
