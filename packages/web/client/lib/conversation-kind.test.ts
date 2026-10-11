import { describe, expect, test } from "bun:test";
import { classifyConversation, conversationSessionId } from "./conversation-kind.ts";
const member = (id: string) => ({ actorId: `session:${id}`, displayName: id, label: id, kind: "session", sessionId: id });
describe("conversation backing classification", () => {
  test("an explicit runtime backing is a Session, regardless of operator membership", () => {
    for (const participantIds of [["operator", "worker"], ["requester", "worker"], []]) {
      expect(classifyConversation({ kind: "direct", sessionId: "sess-1", participantIds })).toBe("session");
    }
  });
  test("one session participant supplies the backing", () => {
    expect(conversationSessionId({ kind: "direct", participants: [member("s")] })).toBe("s");
  });
  test("broker and harness ids describe the same backing, not two sessions", () => {
    expect(conversationSessionId({ kind: "direct", sessionId: "sess.runtime", harnessSessionId: "provider-1" })).toBe("sess.runtime");
  });
  test("legacy direct harness backing is a Session", () => {
    expect(classifyConversation({ kind: "direct", harnessSessionId: "provider-1" })).toBe("session");
  });
  test("two members with no runtime backing are a Chat", () => {
    expect(classifyConversation({ kind: "direct", participantIds: ["alice", "bob"] })).toBe("chat");
    expect(classifyConversation({ kind: "channel", participantIds: ["alice", "bob"] })).toBe("chat");
  });
  test("a room's incidental harness metadata is not a single session", () => {
    expect(classifyConversation({ kind: "channel", harnessSessionId: "provider-1" })).toBe("chat");
  });
  test("multiple distinct session participants fail closed as a Chat", () => {
    expect(classifyConversation({ kind: "direct", sessionId: "a", participants: [member("a"), member("b")] })).toBe("chat");
  });
  test("duplicate members do not fabricate multiple backings", () => {
    expect(classifyConversation({ participants: [member("a"), member("a")] })).toBe("session");
  });
  test("conflicting explicit and participant backings are ambiguous", () => {
    expect(classifyConversation({ sessionId: "a", participants: [member("b")] })).toBe("chat");
  });
  test("missing and blank backings remain Chats", () => {
    expect(classifyConversation(null)).toBe("chat"); expect(classifyConversation({})).toBe("chat");
    expect(classifyConversation({ sessionId: " ", harnessSessionId: "", kind: "direct" })).toBe("chat");
  });
});
test("room session ids represent recent activity, not an exclusive backing", () => {
  for (const kind of ["channel", "group_direct"]) expect(classifyConversation({ kind, sessionId: "last-worker", harnessSessionId: "native-worker", participantIds: ["alice", "bob"] })).toBe("chat");
});
test("a participant's native alias agrees with the broker backing", () => {
  expect(conversationSessionId({ kind: "direct", sessionId: "broker", harnessSessionId: "native", participants: [member("native")] })).toBe("broker");
});
