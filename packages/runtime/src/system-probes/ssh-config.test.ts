import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readSshConfig, sshGResolver } from "./ssh-config.js";

function home(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "scout-ssh-"));
  mkdirSync(join(root, ".ssh", "config.d"), { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, ".ssh", path), text);
  return root;
}

describe("readSshConfig", () => {
  test("one Host line is one machine, its aliases kept as shorthand", async () => {
    const snapshot = await readSshConfig({ home: home({ config: `
Host *
  AddKeysToAgent yes
Host mini arach-mini arachs-mac-mini
  HostName mini.tail1e8e67.ts.net
  User arach
  IdentityFile ~/.ssh/id_ed25519_mini
` }) });
    expect(snapshot.hosts).toHaveLength(1);
    expect(snapshot.hosts[0]).toMatchObject({
      alias: "mini",
      aliases: ["mini", "arach-mini", "arachs-mac-mini"],
      hostName: "mini.tail1e8e67.ts.net",
      user: "arach",
      identityFile: "~/.ssh/id_ed25519_mini",
    });
  });

  test("the first value wins, so a leading Host * default applies and a trailing one only fills gaps", async () => {
    const snapshot = await readSshConfig({ home: home({ config: `
Host *
  User everyone
Host box
  User arach
  HostName box.example
Host *
  Port 2222
  User late
` }) });
    expect(snapshot.hosts[0]).toMatchObject({ alias: "box", user: "everyone", port: 2222 });
  });

  test("wildcards and negations are defaults, never hosts; Match values leak nowhere", async () => {
    const snapshot = await readSshConfig({ home: home({ config: `
Host *.internal !bastion.internal
  User ops
Host box
  HostName 100.101.102.103
Match exec "true"
  User matched
` }) });
    expect(snapshot.hosts.map((host) => host.alias)).toEqual(["box"]);
    expect(snapshot.hosts[0]!.user).toBeUndefined();
  });

  test("Include is followed, relative to ~/.ssh, globs in name order", async () => {
    const snapshot = await readSshConfig({ home: home({
      config: "Include config.d/*\nHost later\n  HostName later.example\n",
      "config.d/b": "Host b\n  HostName b.example\n",
      "config.d/a": "Host a\n  HostName a.example\n  Port 22\n",
    }) });
    expect(snapshot.hosts.map((host) => host.alias)).toEqual(["a", "b", "later"]);
    expect(snapshot.hosts[0]!.port).toBeUndefined();
    expect(snapshot.files).toHaveLength(3);
  });

  test("Git forges are services the config reaches, not machines", async () => {
    const snapshot = await readSshConfig({ home: home({ config: `
Host github.com
  HostName github.com
  User git
Host gitea
  HostName code.example
  User git
` }) });
    expect(snapshot.hosts).toEqual([]);
    expect(snapshot.services.map((service) => service.alias)).toEqual(["github.com", "gitea"]);
  });

  test("a block without HostName reaches the alias itself", async () => {
    const snapshot = await readSshConfig({ home: home({ config: "Host devbox\n  User me\n" }) });
    expect(snapshot.hosts[0]).toMatchObject({ alias: "devbox", hostName: "devbox", user: "me" });
  });

  test("names on one Host line are one machine only when they land on one destination", async () => {
    const snapshot = await readSshConfig({ home: home({ config: "Host alpha beta\n  User deploy\n" }) });
    expect(snapshot.hosts.map((host) => [host.alias, host.hostName])).toEqual([["alpha", "alpha"], ["beta", "beta"]]);
  });

  test("a file included twice applies twice; a cycle stops", async () => {
    const root = home({
      config: "Host alpha\n  Include values\nHost beta\n  Include values\nHost *\n  Include config\n",
      values: "HostName shared.example\n",
    });
    const snapshot = await readSshConfig({ home: root });
    expect(snapshot.hosts).toHaveLength(1);
    expect(snapshot.hosts[0]).toMatchObject({ hostName: "shared.example", aliases: ["alpha", "beta"] });
  });

  test("Include globs work in directory components", async () => {
    const root = home({ config: "Include config.d/*/*.conf\n" });
    mkdirSync(join(root, ".ssh", "config.d", "a"));
    writeFileSync(join(root, ".ssh", "config.d", "a", "hosts.conf"), "Host box\n  HostName box.example\n");
    expect((await readSshConfig({ home: root })).hosts.map((host) => host.hostName)).toEqual(["box.example"]);
  });

  test("Hosts inside an Include only some hosts reach are not names", async () => {
    const snapshot = await readSshConfig({ home: home({
      config: "Host alpha\n  Include nested\nHost beta\n  HostName beta.example\n",
      nested: "Host box\n  HostName actual.example\n",
    }) });
    expect(snapshot.hosts.map((host) => host.alias)).toEqual(["alpha", "beta"]);
  });

  test("ssh -G has the last word: Match and conditional Include as OpenSSH reads them", async () => {
    const root = home({});
    const ssh = join(root, ".ssh");
    writeFileSync(join(ssh, "nested"), "Host box\n  HostName wrong.example\n");
    writeFileSync(join(ssh, "config"), [
      "Host box",
      "Match all",
      "  HostName actual.example",
      "Host alpha",
      `  Include ${join(ssh, "nested")}`,
      "Host mini arach-mini",
      "  HostName mini.example",
      "  User arach",
      `  IdentityFile ${join(root, "key")}`,
    ].join("\n"));
    const snapshot = await readSshConfig({ home: root, resolver: sshGResolver(join(ssh, "config"), root) });
    expect(snapshot.hosts.find((host) => host.alias === "box")?.hostName).toBe("actual.example");
    expect(snapshot.hosts.find((host) => host.alias === "mini")).toMatchObject({
      aliases: ["mini", "arach-mini"],
      user: "arach",
      identityFile: "~/key",
    });
  });

  test("a Match exec in any form keeps ssh -G from running; static Match still applies", async () => {
    const root = home({});
    const marker = join(root, "ran");
    const config = join(root, ".ssh", "config");
    writeFileSync(config, [
      "Host box",
      "Match all",
      "  HostName actual.example",
      `Match !exec "touch ${marker}"`,
      "  User nobody",
      `Match host unrelated exec="touch ${marker}"`,
      "  Port 2200",
    ].join("\n"));
    const snapshot = await readSshConfig({ path: config });
    expect(existsSync(marker)).toBe(false);
    expect(snapshot.hosts[0]).toMatchObject({ alias: "box", hostName: "actual.example" });
    expect(snapshot.hosts[0]!.user).toBeUndefined();
    expect(snapshot.hosts[0]!.port).toBeUndefined();
  });

  test("Match host and user read off the config", async () => {
    const snapshot = await readSshConfig({ home: home({ config: [
      "Host box",
      "  HostName box.lan",
      "Match host *.lan !user root",
      "  User arach",
      "Match originalhost other",
      "  Port 2222",
    ].join("\n") }) });
    expect(snapshot.hosts[0]).toMatchObject({ hostName: "box.lan", user: "arach" });
    expect(snapshot.hosts[0]!.port).toBeUndefined();
  });

  test("no config is an empty snapshot", async () => {
    expect(await readSshConfig({ home: mkdtempSync(join(tmpdir(), "scout-ssh-")) }))
      .toEqual({ hosts: [], services: [], files: [] });
  });
});
