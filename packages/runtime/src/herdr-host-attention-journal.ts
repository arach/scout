/** Durable host-owned persistence contract. Types only: no store, policy or defaults. */
import type { HerdrHostAttentionAnswerDependencies, HerdrHostAttentionAttempt,
  HerdrHostAttentionClaim } from "./herdr-host-attention-answer.js";

/** The three injected kernel callbacks, bound by the host to an authenticated
 * caller. The host rechecks admission under its journal lock; this type grants
 * no authority. Phone and continuation writers must share the same store.
 *
 * Successful admission persists an exclusive physical-terminal claim before
 * acknowledging it. Successful intent persists BOTH intent and audit before
 * input. Commit means crash-safe storage (including required file/directory
 * fsync or an equivalent transactional barrier), not an append or TTL lease.
 * Ambiguous effects remain unresolved without expiration. Finalization and
 * intent compare both owner-token fields at commit, including after await.
 */
export type HerdrHostAttentionJournal = Pick<HerdrHostAttentionAnswerDependencies,
  "admit" | "writeSendIntent" | "finalize">;

/** Logical record shapes, not a mandated storage layout or serialization. */
export type HerdrHostAttentionJournalClaim = {
  schema: "scout.herdr-answer-claim/v1";
  attempt: HerdrHostAttentionAttempt;
  owner: HerdrHostAttentionClaim;
  preparedAt: number;
};
export type HerdrHostAttentionJournalIntent = {
  schema: "scout.herdr-answer-intent/v1";
  attempt: HerdrHostAttentionAttempt;
  owner: HerdrHostAttentionClaim;
  committedAt: number;
};
/** deviceId comes from the authenticated host context, never request text or a
 * generic operator:remote fallback. This data type authenticates nobody. Keep
 * the audit after claim release; correlate it with the durable send intent.
 */
export type HerdrHostAttentionJournalAudit = {
  schema: "scout.herdr-answer-audit/v1";
  deviceId: string;
  attempt: HerdrHostAttentionAttempt;
  owner: HerdrHostAttentionClaim;
  committedAt: number;
};
