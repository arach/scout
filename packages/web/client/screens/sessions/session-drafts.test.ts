import { expect, test } from "bun:test";
import { sessionDraftStore } from "./session-drafts.ts";
test("slot switches, presets and torn-out copies share a session draft, not unrelated identities", () => {
  const store = sessionDraftStore("operator", "local", "s1"); store.write("keep this");
  expect(sessionDraftStore("operator", "local", "s2").read()).toBe("");
  expect(sessionDraftStore("operator", "peer", "s1").read()).toBe("");
  expect(sessionDraftStore("other-operator", "local", "s1").read()).toBe("");
  expect(sessionDraftStore("operator", "local", "s1")).toBe(store);
  expect(sessionDraftStore("operator", "local", "s1").read()).toBe("keep this");
});
test("late send acknowledgement never clears a newer draft", () => {
  const store = sessionDraftStore("op", undefined, "late"); store.write("original"); const sent = store.read();
  store.write("new draft"); store.clearIfUnchanged(sent); expect(store.read()).toBe("new draft");
  store.clearIfUnchanged(store.read()); expect(store.read()).toBe("");
});
