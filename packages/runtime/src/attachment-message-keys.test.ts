import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageRecord } from "@openscout/protocol";
import { SQLiteControlPlaneStore } from "./sqlite-store.js";
import { migrateControlPlaneDatabaseSchema } from "./control-plane-migrations.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scout-attachment-keys-")); roots.push(root);
  const store = new SQLiteControlPlaneStore(join(root, "projection.sqlite"));
  store.upsertNode({ id: "n", meshId: "mesh", name: "Test", advertiseScope: "local", registeredAt: 1 });
  store.upsertActor({ id: "a", kind: "person", displayName: "A" });
  for (const id of ["c1", "c2"]) store.upsertConversation({ id, kind: "direct", title: id, participantIds: ["a"], visibility: "private", shareMode: "local", authorityNodeId: "n" });
  const message = (id: string, conversationId: string, fileName: string): MessageRecord => ({ id, conversationId, actorId: "a", originNodeId: "n", class: "agent", body: id, visibility: "private", policy: "durable", createdAt: 1,
    attachments: [{ id: "same-id", mediaType: "image/png", fileName, blobKey: "legacy" }] });
  return { root, store, message };
}
test("attachment ids are scoped to their owning message across conversations and retries", () => {
  const { store, message } = fixture();
  try {
    store.recordMessage(message("m1", "c1", "first.png"));
    store.recordMessage(message("m2", "c2", "second.png"));
    expect(store.readMessages(["m1", "m2"]).get("m1")?.attachments?.[0]?.fileName).toBe("first.png");
    expect(store.readMessages(["m1", "m2"]).get("m2")?.attachments?.[0]?.fileName).toBe("second.png");
    store.recordMessage(message("m1", "c1", "first-updated.png"));
    expect(store.loadSnapshot().messages.m2?.attachments?.[0]?.fileName).toBe("second.png");
    store.recordMessage({ ...message("m1", "c1", ""), attachments: [] });
    expect(store.readMessages(["m2"]).get("m2")?.attachments?.[0]?.fileName).toBe("second.png");
  } finally { store.close(); }
});
test("repairs a legacy global attachment key without losing the retained row", () => {
  const { root, store, message } = fixture();
  store.recordMessage(message("m1", "c1", "retained.png")); store.close();
  const db = new Database(join(root, "projection.sqlite"));
  try {
    db.exec(`ALTER TABLE message_attachments RENAME TO old_attachments;
      CREATE TABLE message_attachments(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, media_type TEXT NOT NULL, file_name TEXT, blob_key TEXT, url TEXT, metadata_json TEXT);
      INSERT INTO message_attachments SELECT id,message_id,media_type,file_name,blob_key,url,metadata_json FROM old_attachments; DROP TABLE old_attachments; PRAGMA user_version=18;`);
    migrateControlPlaneDatabaseSchema(db);
    migrateControlPlaneDatabaseSchema(db);
    const pk = (db.query("PRAGMA table_info(message_attachments)").all() as Array<{ name: string; pk: number }>).filter(c => c.pk).sort((a,b) => a.pk-b.pk).map(c => c.name);
    expect(pk).toEqual(["message_id", "id"]);
    expect(db.query("SELECT file_name FROM message_attachments WHERE message_id='m1'").get()).toEqual({ file_name: "retained.png" });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { db.close(); }
});
