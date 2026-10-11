/** Operator input, not a Scout message, ask, flight, or resumed session. */
export const SESSION_STEER_MAX_LENGTH = 32_000;

export type SessionSteerTarget = {
  pid: number;
  processStart: string;
  host: "herdr" | "orca" | "tmux" | "terminal";
  address: string;
  tty: string | null;
};
export type SessionSteerAvailability = {
  available: boolean;
  code: string;
  reason: string;
  target: SessionSteerTarget | null;
};
export type SessionSteerAuditEntry = {
  id: string;
  at: string;
  operator: string;
  sessionRef: string;
  machine: string | null;
  serverHost: string;
  target: SessionSteerTarget | null;
  outcome: "accepted" | "refused" | "unconfirmed";
  code: string;
  reason: string;
  /** UTF-16 code units, as in the composer maxlength. */
  textLength: number;
  /** SHA-256 of the submitted text. Bodies are never stored in this audit. */
  textSha256: string;
  duplicateOutcomes?: number;
};
export type SessionSteerReceipt = { ok: boolean; audit: SessionSteerAuditEntry };
