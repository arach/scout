import { z } from 'zod';
/** Wire principal, pinned from the relay envelope, not from tool arguments. */
export const principalSchema = z.object({
  kind: z.enum(['oauth', 'agent_token']), id: z.string().min(1).max(256), userId: z.string().min(1).max(256).optional(),
  ownerKey: z.string().min(1).max(256), node: z.string().min(1).max(256), agentId: z.string().min(1).max(512),
}).strict();
