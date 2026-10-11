import { createChatLocalStore } from "../chat-space/chat-local-state.ts";

// Reuse the client draft store's acknowledgement and subscription semantics.
// Session drafts survive slot/preset unmounts in this tab; they are not Scout
// records and are not written to persistent browser storage.
const stores = new Map<string, ReturnType<typeof createChatLocalStore<string>>>();
export function sessionDraftStore(actor: string, machine: string | undefined, sessionId: string) {
  const key = JSON.stringify([actor, machine ?? null, sessionId]);
  let store = stores.get(key);
  if (!store) {
    store = createChatLocalStore(key, "", (value) => typeof value === "string" ? value : "", null);
    stores.set(key, store);
  }
  return store;
}
