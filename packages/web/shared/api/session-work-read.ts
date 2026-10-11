// Scoutbot's read of a session's work, as GET /api/session-work-read serves it.

export type SessionWorkSteering = {
  text: string;
  /** Index into the session's operator prompts, oldest first. */
  askIndex: number | null;
  at: number | null;
  supersedes: string | null;
};

export type SessionWorkRead = {
  now: string;
  steering: SessionWorkSteering[];
  shape: {
    goal: string | null;
    must: string[];
    mustNot: string[];
    deliver: string | null;
  };
};

export type SessionWorkReadResponse =
  | {
      status: "ready";
      read: SessionWorkRead;
      model: string;
      generatedAt: number;
      turn: number;
      stale?: boolean;
    }
  | { status: "pending"; turn: number }
  | { status: "unavailable"; detail: string; turn: number };
