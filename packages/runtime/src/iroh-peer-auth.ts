/** Dedicated ingress mount: older brokers return 404 instead of trusting loopback.
 * The authenticated caller is a Scout node key, NOT the independently generated
 * Iroh transport key. Bind its proof to the receiving Iroh endpoint and the
 * exact inner HTTP request; the receiver always applies the remote route gate.
 */
export const IROH_INGRESS_PREFIX = "/v1/iroh";
export const IROH_MESH_PATHS = {
  messages: "/v1/mesh/messages",
  invocations: "/v1/mesh/invocations",
  "collaboration/records": "/v1/mesh/collaboration/records",
  "collaboration/events": "/v1/mesh/collaboration/events",
} as const;
export function irohDestinationKeyId(endpointId: string): string {
  if (!/^[a-f0-9]{64}$/.test(endpointId)) throw new Error("invalid Iroh endpoint identity");
  // Disjoint from ordinary HTTP's SHA-256 destination key IDs.
  return `iroh:${endpointId}`;
}
