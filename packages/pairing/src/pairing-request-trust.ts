import { isIP } from "node:net";

import { networkInterfaces } from "node:os";

import type { Context } from "hono";

import { getConnInfo } from "hono/bun";

const LOOPBACK_IPV4_HOST_PATTERN = /^127(?:\.\d{1,3}){3}$/;

function localInterfaceAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .map((entry) => entry.address);
}

export function isSameMacScoutRequest(
  request: Request,
  peerAddress?: string,
  ownAddresses: readonly string[] = localInterfaceAddresses(),
): boolean {
  if (!peerAddress || !isLoopbackScoutAddress(peerAddress)) return false;
  if (request.headers.has("forwarded")) return false;

  const forwardedAddresses = [
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip"),
  ].filter((value): value is string => value !== null);
  for (const value of forwardedAddresses) {
    if (value.includes(",")) return false;
    const clientAddress = normalizeIpAddress(value);
    if (!clientAddress) return false;
    if (
      !isLoopbackScoutAddress(clientAddress)
      && !ownAddresses.some((address) => normalizeIpAddress(address) === clientAddress)
    ) {
      return false;
    }
  }
  return true;
}

function normalizeIpAddress(address: string): string | null {
  const normalized = normalizeHostname(address);
  const unmapped = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  return isIP(unmapped) ? unmapped : null;
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function isLoopbackScoutAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized === "::1" || normalized === "localhost") {
    return true;
  }
  // Unwrap IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1).
  const mapped = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
  return LOOPBACK_IPV4_HOST_PATTERN.test(mapped);
}

export function resolveScoutRequestPeerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}
