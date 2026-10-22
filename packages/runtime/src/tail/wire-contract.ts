import { TRPCError } from "@trpc/server";
import { StreamResyncRequired } from "../bounded-event-iterable.js";
import type { TailReplayImage } from "./replay-buffer.js";

/** Internal wire names. No runtime authorization or consumer adoption here. */
export type TailSubscriptionStatus = {
  type: "tail.subscription";
  schema: "scout.tail-subscription/v1";
  epoch: string;
  cursorFound: boolean | null;
  cursorStatus:
    | "not_requested"
    | "found"
    | "not_retained"
    | "epoch_mismatch"
    | "ambiguous";
  epochBinding: "matched" | "mismatch" | "not_supplied";
  replayLimit: 500;
  replayCount: number;
  barrier: "bounded-replay-live/v1";
};
export type TailResyncData = {
  schema: "scout.tail-error/v1";
  code: "resync_required";
  lastDeliveredId: string | null;
  resyncRequired: true;
  epoch: string;
};

/** Resolve the cursor in the unfiltered, bounded image, never the full ring. */
export function tailReplaySelection(
  image: TailReplayImage,
  input:
    | {
        since?: string;
        sources?: string[];
        tailProtocol?: 1;
        sinceEpoch?: string;
      }
    | undefined,
): { startIndex: number; status: TailSubscriptionStatus } {
  const binding =
    input?.sinceEpoch === undefined
      ? "not_supplied"
      : input.sinceEpoch === image.epoch
        ? "matched"
        : "mismatch";
  const matches: number[] = [];
  if (input?.since) {
    for (let i = 0; i < image.entries.length; i++)
      if (image.entries[i].event.id === input.since) matches.push(i);
  }
  const cursorStatus = !input?.since
    ? "not_requested"
    : binding === "mismatch"
      ? "epoch_mismatch"
      : matches.length === 0
        ? "not_retained"
        : matches.length > 1
          ? "ambiguous"
          : "found";
  // Legacy duplicate IDs keep their first-match suffix behavior.
  const startIndex =
    input?.tailProtocol === 1
      ? cursorStatus === "found"
        ? matches[0] + 1
        : 0
      : matches.length
        ? matches[0] + 1
        : 0;
  const sources = input?.sources?.length ? new Set(input.sources) : null;
  let replayCount = 0;
  for (let i = startIndex; i < image.entries.length; i++)
    if (!sources || sources.has(image.entries[i].event.source)) replayCount++;
  return {
    startIndex,
    status: {
      type: "tail.subscription",
      schema: "scout.tail-subscription/v1",
      epoch: image.epoch,
      cursorFound:
        cursorStatus === "not_requested" ? null : cursorStatus === "found",
      cursorStatus,
      epochBinding: binding,
      replayLimit: 500,
      replayCount,
      barrier: "bounded-replay-live/v1",
    },
  };
}

/** Class identity, not a message/code-property convention. Captured epoch and
 * outer server-yield cursor are evidence, not an acknowledgment by a client. */
export class TailResyncRequired extends StreamResyncRequired {
  constructor(
    readonly epoch: string,
    lastDeliveredId?: string,
  ) {
    super(lastDeliveredId);
  }
}

/** Only trusted tRPC cause wrappers may lead to the branded error. */
export function tailResyncData(
  path: string | undefined,
  error: TRPCError,
): TailResyncData | undefined {
  if (path !== "tail.events") return;
  let cause: unknown = error;
  const seen = new Set<TRPCError>();
  while (cause instanceof TRPCError && !seen.has(cause)) {
    seen.add(cause);
    cause = cause.cause;
  }
  if (!(cause instanceof TailResyncRequired)) return;
  return {
    schema: "scout.tail-error/v1",
    code: "resync_required",
    lastDeliveredId: cause.lastDeliveredId ?? null,
    resyncRequired: true,
    epoch: cause.epoch,
  };
}
