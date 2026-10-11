/**
 * Cast identity, resolved without the operator shell.
 *
 * Lives here rather than in `AgentAvatar.tsx` so the desktop companion's own
 * runtime can resolve a figure's character without importing `ScoutProvider`.
 * `ScoutProvider`'s context value satisfies `CastScope` structurally.
 */

import { assignCastSlug, matchCastSlug } from "./crew-registry.ts";
import { resolveAgentCharacterAssignment, type ScoutAppearanceDetails } from "./theme.ts";

export type CastScope = {
  operatorName?: string | null;
  onboarding?: { operatorName?: string | null; operatorNameSuggestion?: string | null } | null;
  appearanceDetails?: Pick<ScoutAppearanceDetails, "operatorCharacter" | "agentCharacters"> | null;
  agents?: ReadonlyArray<{ id: string; name: string }>;
};

/**
 * Which cast member an agent IS — or nobody. Exported so the surfaces that
 * draw a member beyond the coin (the crew photo, the profile stage) resolve
 * identity exactly the way the coin does, and can decline to draw a member
 * that has none.
 */
export function castSlugForAgent(
  scout: CastScope | null | undefined,
  input: { agent?: { id?: string | null; name: string; slug?: string | null }; name?: string; slug?: string },
): { castSlug: string | undefined; isOperator: boolean } {
  const { agent, slug } = input;
  const label = agent?.name ?? input.name ?? "?";
  /* The cached name first: it is the same value the server will confirm, and it
     is here in frame one. Without it every avatar labelled with the operator's
     real name fails the isOperator test on first paint and renders as somebody
     else's generative sprite, then swaps to the chosen character when the fetch
     lands — a worse flicker than the blank it replaced. */
  const operatorName =
    scout?.operatorName
    || scout?.onboarding?.operatorName?.trim()
    || scout?.onboarding?.operatorNameSuggestion?.trim()
    || "operator";

  const isOperator =
    label.toLowerCase() === "operator"
    || label.toLowerCase() === "you"
    || label.toLowerCase() === operatorName.toLowerCase()
    || label.toLowerCase() === "art";

  const operatorCharacter = scout?.appearanceDetails?.operatorCharacter || "milo";

  /**
   * A cast slug is something you ARE, not something you get handed.
   *
   * Precedence: an explicit `slug` prop, the operator's own character pick,
   * then the operator's assignment for this agent — each is a choice about
   * this identity, so it may fall back to a deterministic cast member. Last
   * comes accidental name match ("milo-runner" names Milo). An agent with
   * none of those renders as its own generative sprite: assigning it a cast
   * face at random aliases two identities into one, which reads as "these
   * are the same agent" everywhere avatars are the cue.
   */
  const assignedCharacter = isOperator
    ? undefined
    : resolveAgentCharacterAssignment(
        scout?.appearanceDetails?.agentCharacters,
        { id: agent?.id, name: label },
        scout?.agents ?? [],
      );
  const castSlug = slug
    ? (matchCastSlug(slug) ?? assignCastSlug(slug))
    : isOperator
      ? (matchCastSlug(operatorCharacter) ?? assignCastSlug(operatorCharacter))
      : (matchCastSlug(assignedCharacter)
        ?? matchCastSlug(agent?.slug || label));

  return { castSlug, isOperator };
}
