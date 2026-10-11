import { endpointAgentName, endpointRuntimeInstanceId } from "./local-agents.js";
import { existingAcpNativeSession } from "./acp-agent-invocation.js";
import type { AgentEndpoint } from "@openscout/protocol";
import { existingCodexNativeSession } from "@openscout/agent-sessions/local";
import { existingClaudeNativeSession } from "./claude-stream-json.js";
import type { NativeTurnObservation } from "./room-listening-delivery.js";

/** Generic live transport-owner primitive. No room state, scheduler, invocation,
 * config resolution, launch, resume, fork, output posting, or pane fallback. */
export async function nativeSessionAttention(endpoint: AgentEndpoint, input?: {
  sessionId: string; token: string; action: "revive" | "steer"; prompt: string;
}, stillCurrent: () => boolean = () => true): Promise<NativeTurnObservation | { accepted: boolean; evidence: string }> {
  const refuse = (state: NativeTurnObservation["state"]) => input ? { accepted: false, evidence: state } : { state };
  if (endpoint.pane || endpoint.transport === "tmux" || endpoint.metadata?.placement !== "background") return refuse("unsupported");
  if (["stopped", "superseded"].includes(endpoint.state)) return refuse("gone");
  const agentName = endpointAgentName(endpoint), runtimeId = endpointRuntimeInstanceId(endpoint);
  const owner = endpoint.transport === "codex_app_server" ? existingCodexNativeSession(agentName, runtimeId)
    : endpoint.transport === "claude_stream_json" ? existingClaudeNativeSession(agentName, runtimeId)
    : endpoint.transport.endsWith("_acp") ? await existingAcpNativeSession(endpoint.id) : undefined;
  if (!owner) return refuse(["codex_app_server", "claude_stream_json"].includes(endpoint.transport) ? "unknown" : "unsupported");
  if (!stillCurrent()) return refuse("unknown");
  return input ? owner.submit(input, input.action, input.prompt) : owner.observe();
}
