import { describe, expect, test } from "bun:test";
import { suggestScoutCommand, unknownScoutCommandMessage } from "./registry.ts";

describe("unknown command teaching", () => {
  test("suggests a near miss", () => {
    expect(suggestScoutCommand("hsots")).toBe("hosts");
    expect(suggestScoutCommand("aks")).toBe("ask");
    expect(unknownScoutCommandMessage("chekc", "0.2.70")).toContain("Did you mean `scout check`?");
  });

  test("points far misses at the version and scout update", () => {
    expect(suggestScoutCommand("teleport")).toBeUndefined();
    const message = unknownScoutCommandMessage("teleport", "0.2.70");
    expect(message).toContain("This scout is 0.2.70");
    expect(message).toContain("scout update");
    expect(message.startsWith("unknown command: teleport")).toBe(true);
  });
});
