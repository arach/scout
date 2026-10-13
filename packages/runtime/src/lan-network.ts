import { BlockList, isIP } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export type ScoutLanNetwork = {
  name: string;
  address: string;
  netmask: string;
  cidr: string;
  family: "IPv4" | "IPv6";
};

// Ordinary Ethernet/Wi-Fi interfaces only. In particular, VPN/tunnel, overlay,
// container and loopback interfaces must never turn LAN-only into remote access.
const LAN_INTERFACE = /^(?:en\d+|eth\d+|wlan\d+|en[opsx][a-z0-9]+|wl[opsx][a-z0-9]+)$/i;

export function resolveScoutLanNetworks(
  interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces(),
): ScoutLanNetwork[] {
  return Object.entries(interfaces).flatMap(([name, addresses]) => {
    if (!LAN_INTERFACE.test(name)) return [];
    return (addresses ?? []).flatMap((entry): ScoutLanNetwork[] => {
      if (entry.internal || !entry.cidr || !isIP(entry.address.split("%")[0]!)) return [];
      if (entry.family !== "IPv4" && entry.family !== "IPv6") return [];
      return [{ name, address: entry.address.split("%")[0]!, netmask: entry.netmask,
        cidr: entry.cidr.split("%")[0]!, family: entry.family }];
    });
  });
}

export function isScoutLanAddress(address: string, networks: readonly ScoutLanNetwork[]): boolean {
  const unwrapped = address.replace(/^::ffff:/i, "").split("%")[0]!;
  const family = isIP(unwrapped);
  if (!family) return false;
  for (const network of networks) {
    if ((network.family === "IPv4" ? 4 : 6) !== family) continue;
    const [base, bits] = network.cidr.split("/");
    const prefix = Number(bits);
    if (!base || !bits || !Number.isInteger(prefix)) continue;
    try {
      const subnet = new BlockList();
      const type = family === 4 ? "ipv4" : "ipv6";
      subnet.addSubnet(base, prefix, type);
      if (subnet.check(unwrapped, type)) return true;
    } catch { /* An unusable interface cannot grant access. */ }
  }
  return false;
}
