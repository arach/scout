import type { AgentEndpoint } from "@openscout/protocol";
import { a2aExecutionUrlForEndpoint } from "./a2a-http-endpoint.js";
import { isExternalSessionEndpoint } from "./external-session-transport.js";

/** Undefined means a local process probe owns the answer, not a receive transport. */
export function receiveTransportLiveness(endpoint: AgentEndpoint): boolean | undefined {
  if (!isExternalSessionEndpoint(endpoint)
    && !(endpoint.transport === "http" && a2aExecutionUrlForEndpoint(endpoint))) return undefined;
  // Accept legacy "online" records without widening the protocol's AgentState.
  return ["online", "idle", "active", "waiting", "working"].includes(endpoint.state)
    || (endpoint.transport === "mcp_poll" && endpoint.state === "registered");
}

/** Cloud/mailbox receive evidence never requires a local harness process. */
export function localEndpointCanReceive(endpoint: AgentEndpoint, localProcessAlive: (endpoint: AgentEndpoint) => boolean): boolean {
  return receiveTransportLiveness(endpoint) ?? localProcessAlive(endpoint);
}
