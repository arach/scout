import { api } from "./api.ts";
import type { OperatorAttentionState } from "./types.ts";
import { isDeclaredRequest, stableRequestItems } from "../screens/requests/requests-model.ts";
import { isScoutSurfaceActive, onScoutSurfaceActivated } from "./surface-activity.ts";

export type RequestsSnapshot = { state: OperatorAttentionState | null; error: string | null; loading: boolean };
let snapshot: RequestsSnapshot = { state: null, error: null, loading: true };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let stopActivation: (() => void) | null = null;
let inFlight: Promise<void> | null = null;
let revision = 0;
const emit = () => { for (const listener of listeners) listener(); };
export const getRequestsSnapshot = () => snapshot;

export function receiveRequests(state: OperatorAttentionState): void {
  revision++;
  snapshot = { state: { ...state, items: stableRequestItems(snapshot.state?.items ?? [], state.items.filter(isDeclaredRequest)) }, error: null, loading: false };
  emit();
}

export function refreshRequests(): Promise<void> {
  if (inFlight) return inFlight;
  const startedAtRevision = revision;
  inFlight = api<OperatorAttentionState>("/api/operator-attention").then((state) => {
    // A decision response is newer than a GET that started before the decision.
    if (revision === startedAtRevision) receiveRequests(state);
  }).catch((cause) => {
    if (revision !== startedAtRevision) return;
    snapshot = { ...snapshot, error: cause instanceof Error ? cause.message : "Requests could not be loaded", loading: false };
    emit();
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export function subscribeRequests(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshRequests();
    timer = setInterval(() => { if (isScoutSurfaceActive()) void refreshRequests(); }, 15_000);
    stopActivation = onScoutSurfaceActivated(() => { void refreshRequests(); });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { if (timer) clearInterval(timer); timer = null; stopActivation?.(); stopActivation = null; }
  };
}
