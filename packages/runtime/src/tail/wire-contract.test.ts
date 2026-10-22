import { expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { StreamResyncRequired } from "../bounded-event-iterable.js";
import { TailResyncRequired, tailResyncData } from "./wire-contract.js";

const epoch = "4bbe218c-5499-4bb9-a3ea-656cfc6f52a6";
const wrapped = (cause: unknown) =>
  new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
test("branded resync survives tRPC cause wrappers with allowlisted null cursor data", () => {
  const error = new TailResyncRequired(epoch);
  // Message is not the discriminator. This also protects against a formatter
  // mutant that parses the old human text rather than the class identity.
  error.message = "a different human explanation";
  expect(tailResyncData("tail.events", wrapped(wrapped(error)))).toEqual({
    schema: "scout.tail-error/v1",
    code: "resync_required",
    lastDeliveredId: null,
    resyncRequired: true,
    epoch,
  });
});
test("plain message, property-shaped and generic stream errors cannot impersonate tail resync", () => {
  for (const error of [
    new Error(
      "resync_required Stream consumer fell behind; resnapshot before reconnecting.",
    ),
    new StreamResyncRequired("A"),
    Object.assign(new Error("resync_required"), {
      code: "resync_required",
      epoch,
      lastDeliveredId: "A",
    }),
    { code: "resync_required", epoch, lastDeliveredId: "A" },
    new TRPCError({ code: "UNAUTHORIZED" }),
    new TRPCError({ code: "FORBIDDEN" }),
  ])
    expect(tailResyncData("tail.events", wrapped(error))).toBeUndefined();
});
test("branded error never extends another procedure's error data", () => {
  for (const path of [
    undefined,
    "control.events",
    "topology.events",
    "tail.recent",
    "tail.events.extra",
  ])
    expect(
      tailResyncData(path, wrapped(new TailResyncRequired(epoch, "A"))),
    ).toBeUndefined();
});
test("cyclic tRPC cause is not a resync error", () => {
  const error = wrapped(undefined);
  Object.assign(error, { cause: error });
  expect(tailResyncData("tail.events", error)).toBeUndefined();
});

test("production aggregate shares one epoch across captures and rotates on destructive reset", async () => {
  const { tailReplayEpoch, attachTailReplay, __testing } = await import(
    "./service.js"
  );
  const epoch = tailReplayEpoch();
  const a = attachTailReplay({ limit: 500 }, () => {});
  const b = attachTailReplay({ limit: 500 }, () => {});
  try {
    expect(a.image.epoch).toBe(epoch);
    expect(b.image.epoch).toBe(epoch);
    __testing.resetTailEventBuffers();
    expect(tailReplayEpoch()).not.toBe(epoch);
    expect(() => a.check()).toThrow(StreamResyncRequired);
    expect(() => b.check()).toThrow(StreamResyncRequired);
  } finally {
    a.close();
    b.close();
  }
});
