import { useSyncExternalStore } from "react";
import { getRequestsSnapshot, subscribeRequests } from "./operator-requests-store.ts";
export function useOperatorRequests() {
  return useSyncExternalStore(subscribeRequests, getRequestsSnapshot, getRequestsSnapshot);
}
