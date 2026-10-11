import { describe, expect, test } from "bun:test";
import type { MachineRecord } from "@openscout/protocol";
import type { MachineReadiness } from "@openscout/runtime/system-probes";

import { buildHostsModel, compareVersions, hostBlock, rowNote } from "./hosts-model.ts";

const NOW = 1_000_000_000;

function machine(id: string, patch: Partial<MachineRecord> = {}): MachineRecord {
  return {
    id,
    displayName: null,
    name: id,
    platform: "macos",
    identityKeys: [],
    isSelf: false,
    hostNames: [id],
    addresses: [],
    macAddresses: [],
    capabilities: [],
    routes: [],
    evidence: [{ kind: "tailnet", observedAt: NOW, peerId: id, dnsName: `${id}.tail1e8e67.ts.net.`, addresses: [], online: true }],
    pinned: false,
    firstSeenAt: 1,
    lastSeenAt: NOW,
    ...patch,
  };
}

function reading(patch: Partial<MachineReadiness> = {}): MachineReadiness {
  return {
    testedAt: NOW,
    via: "ssh",
    destination: "x",
    reachable: true,
    failure: null,
    failureDetail: null,
    os: "Darwin",
    arch: "arm64",
    hostName: "x",
    osVersion: "27.0.1",
    scoutVersion: "0.3.6",
    tools: { scout: "/s", herdr: "/h", tmux: "/t", orca: null, claude: "/c", codex: "/x" },
    ...patch,
  };
}

const ssh = (alias: string) => ({ sshTargets: [{ alias, aliases: [alias], hostName: `${alias}.tail1e8e67.ts.net`, configPath: "~/.ssh/config" }] });

const SELF = machine("arts-mini", { isSelf: true });
const MINI = machine("mini", ssh("mini"));
const AIR = machine("air", ssh("air"));
const LAB = machine("studio-lab", { platform: "linux" });
const PHONE = machine("iphone-13-mini", { platform: "ios" });
const MAC_ONLY = machine("2e:18", { hostNames: [], evidence: [{ kind: "lan", observedAt: NOW, method: "arp", addresses: [], macAddress: "2e:18:2a:be:39:7d" }] });
const STALE = machine("art", {
  hostNames: [],
  lastSeenAt: 0,
  evidence: [{ kind: "ssh", observedAt: NOW, alias: "art", aliases: ["art"], hostName: "arts-mac-mini.tail1e8e67.ts.net", configPath: "~/.ssh/config" }],
  ...ssh("art"),
});

describe("hosts model", () => {
  test("network first: tailnet, local, then config-only; devices fold into a line", () => {
    const model = buildHostsModel([LAB, PHONE, MAC_ONLY, STALE, AIR, SELF, MINI], {}, NOW);
    expect(model.sections.map((section) => section.id)).toEqual(["tailnet", "local", "configured"]);
    expect(model.sections[0]!.label).toBe("Tailnet · tail1e8e67.ts.net");
    // This Mac, then machines with an SSH entry, then the rest — by name.
    expect(model.sections[0]!.rows.map((row) => row.name)).toEqual(["arts-mini", "air", "mini", "studio-lab"]);
    expect(model.sections[1]!.rows[0]!.kind).toBe("neighbours");
    expect(model.sections[2]!.rows[0]!.presence).toBe("listed");
    expect(model.devices).toEqual(["iphone-13-mini"]);
  });

  test("an older record of this Mac folds into it", () => {
    const ghost = machine("arts mini", { isSelf: true, lastSeenAt: NOW - 1_000_000 });
    const rows = buildHostsModel([SELF, ghost, MINI], {}, NOW).sections[0]!.rows;
    expect(rows.map((row) => row.name)).toEqual(["arts-mini", "mini"]);
  });

  test("a test never reorders rows", () => {
    const before = buildHostsModel([SELF, MINI, AIR, LAB], {}, NOW).sections[0]!.rows.map((row) => row.id);
    const after = buildHostsModel([SELF, MINI, AIR, LAB], { "studio-lab": reading(), air: reading({ reachable: false, failure: "timeout" }) }, NOW)
      .sections[0]!.rows.map((row) => row.id);
    expect(after).toEqual(before);
  });

  test("gauges read the test against the newest Scout seen", () => {
    const model = buildHostsModel([SELF, MINI, AIR], {
      mini: reading(),
      air: reading({ scoutVersion: "0.3.0", tools: { scout: "/s", herdr: "/h", tmux: "/t", orca: null, claude: "/c", codex: null } }),
      "arts-mini": reading({ via: "local", scoutVersion: "0.2.108" }),
    }, NOW);
    const rows = Object.fromEntries(model.sections[0]!.rows.map((row) => [row.name, row]));
    expect(model.newestScout).toBe("0.3.6");
    expect(rows.mini!.gauges.map((gauge) => gauge.value)).toEqual(["answers", "0.3.6", "herdr tmux", "claude codex"]);
    expect(rows.air!.gauges[1]!.segments).toEqual(["on", "on", "off"]);
    expect(rows["arts-mini"]!.gauges[1]!.segments).toEqual(["on", "off", "off"]);
    expect(rows["arts-mini"]!.gauges[0]!.value).toBe("this Mac");
    expect(rowNote(rows.air!, model.newestScout)).toBe("Scout 0.3.0 here; the newest in your fleet is 0.3.6. Not found: codex.");
  });

  test("untested rows show dashed gauges, failures say why", () => {
    const model = buildHostsModel([SELF, LAB, STALE], {
      art: reading({ reachable: false, failure: "unresolved", failureDetail: "The name doesn't resolve." }),
    }, NOW);
    const lab = model.sections[0]!.rows[1]!;
    expect(lab.gauges[0]).toMatchObject({ segments: ["off", "unknown", "unknown"], value: "no entry" });
    expect(lab.gauges[1]!.segments).toEqual(["unknown", "unknown", "unknown"]);
    expect(hostBlock(lab)).toBe("Host studio-lab\n  HostName studio-lab.tail1e8e67.ts.net");
    const art = model.sections.find((section) => section.id === "configured")!.rows[0]!;
    expect(art.gauges[0]).toMatchObject({ segments: ["on", "off", "off"], value: "won't resolve" });
    expect(rowNote(art, null)).toBe("The name doesn't resolve.");
  });

  test("versions compare numerically", () => {
    expect(compareVersions("0.2.108", "0.3.0")).toBeLessThan(0);
    expect(compareVersions("0.3.10", "0.3.6")).toBeGreaterThan(0);
  });
});
