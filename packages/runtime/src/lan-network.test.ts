import { expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { isScoutLanAddress, resolveScoutLanNetworks } from "./lan-network.ts";

const address = (ip: string, cidr: string, family = "IPv4", internal = false) => ({
  address: ip, cidr, family, internal, netmask: "255.255.255.0", mac: "00:11:22:33:44:55",
}) as NetworkInterfaceInfo;

test("LAN selection excludes VPN, loopback and virtual interfaces", () => {
  const networks = resolveScoutLanNetworks({
    en0: [address("192.168.18.11", "192.168.18.11/24")],
    utun3: [address("100.104.66.99", "100.104.66.99/32")],
    tailscale0: [address("100.104.66.99", "100.104.66.99/32")],
    lo0: [address("127.0.0.1", "127.0.0.1/8", "IPv4", true)],
    docker0: [address("172.18.0.1", "172.18.0.1/16")],
  });
  expect(networks.map(n => n.name)).toEqual(["en0"]);
  expect(isScoutLanAddress("192.168.18.22", networks)).toBe(true);
  expect(isScoutLanAddress("::ffff:192.168.18.22", networks)).toBe(true);
  for (const remote of ["100.104.66.99", "192.168.19.22", "8.8.8.8", "127.0.0.1", "invalid"]) {
    expect(isScoutLanAddress(remote, networks)).toBe(false);
  }
});

test("LAN addresses follow physical interface changes and include local IPv6", () => {
  const networks = resolveScoutLanNetworks({
    en0: [address("fe80::123", "fe80::123/64", "IPv6")],
    wlp2s0: [address("10.0.0.2", "10.0.0.2/24")],
  });
  expect(isScoutLanAddress("fe80::456%en0", networks)).toBe(true);
  expect(isScoutLanAddress("10.0.0.30", networks)).toBe(true);
  expect(isScoutLanAddress("192.168.18.22", networks)).toBe(false);
  expect(resolveScoutLanNetworks({})).toEqual([]);
  expect(isScoutLanAddress("10.0.0.30", [])).toBe(false);
});
