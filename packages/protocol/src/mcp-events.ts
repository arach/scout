/** Authenticated by the public gateway, never taken from MCP arguments. No bearer secrets. */
export interface McpEventPrincipal {
  kind: "oauth" | "agent_token";
  id: string;
  userId?: string;
  ownerKey: string;
  node: string;
  agentId: string;
}

export interface McpEventDelivery {
  id: string;
  lease: string;
  subscriptionId: string;
  principal: McpEventPrincipal;
  url: string;
  secret: string;
  previousSecret?: string;
  body: string;
}

export const MCP_EVENTS_PROTOCOL = "2026-07-28";
