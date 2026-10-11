import { createHash } from "node:crypto";
import type { RouteTerm } from "./types.js";

// Harness instructions, coding boilerplate and function words are not topics.
const STOP = new Set(`a an and are as at be been but by can could do does for from has have how i if in into is it its me my of on or our please so that the their them then there these they this to use was we what when where which will with would you your src test tests function const return import export bun fix true false null undefined let var async await string number assistant user system tool tools result command run output agent agents session sessions project projects request response token tokens instructions context work using done code file files task read implement change changes report help one all not only also should must need new existing now currently`.split(/\s+/));

export function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function words(text: string): string[] {
  return text.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase().match(/[\p{L}][\p{L}\p{N}]{1,63}/gu)?.filter((word) => !STOP.has(word)) ?? [];
}

// Fingerprints must not learn UUIDs, checkout prefixes, or generated file suffixes.
// Query tokenization stays separate so exact identifiers remain searchable in S2.
const SOURCE_NOISE = new Set("users private tmp dev scratchpad node_modules packages apps sources swift ts tsx js jsx mjs json md html css lock png jpg webp svg git com org local stdout stderr exit wall time seconds tokens uuid cwd".split(" "));
function fingerprintLines(text: string): string[] {
  return text
    .replace(/https?:\/\/[^\s)]+/g, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{4,}\b/gi, " ")
    // Keep the meaningful filename, not the host/user/worktree prefix repeated
    // in every tool result. Newlines prevent invented cross-path bigrams.
    .replace(/(?:[~.]?\/)?(?:[\w.@-]+\/)+([\w.-]+)/g, "\n$1\n")
    .replace(/\.(?:swift|tsx?|jsx?|mjs|json|md|css|html|png|webp|svg|lock)\b/gi, " ")
    .split(/[\r\n.!?;]+/);
}
export function extractTerms(text: string, field: RouteTerm["field"], lastUsedAt: number, multiplier = 1): RouteTerm[] {
  const counts = new Map<string, number>();
  const bigrams = new Map<string, number>();
  for (const line of fingerprintLines(text)) {
    const tokens = words(line).filter((word) => !SOURCE_NOISE.has(word));
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      counts.set(token, (counts.get(token) ?? 0) + 1);
      if (i && tokens[i - 1] !== token) {
        const bigram = `${tokens[i - 1]} ${token}`;
        bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
      }
    }
  }
  for (const [term, count] of bigrams) if (count >= 2) counts.set(term, count);
  return [...counts].map(([term, count]) => ({ term, field, weight: Math.min(4, count) * multiplier, lastUsedAt }));
}

/** Paths contribute topic-bearing basenames once, not repeated directory scaffolding. */
export function extractPathTerms(paths: string[], field: RouteTerm["field"], time: number): RouteTerm[] {
  return extractTerms([...new Set(paths.map((path) => path.split(/[\\/]/).at(-1) ?? ""))].join("\n"), field, time, 2);
}

/** Same identity matching ladder as scoreTextCandidate, without liveness bonuses. */
export function scoreRouteName(value: string, query: string): number {
  const name = value.trim().toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!name || !needle) return 0;
  if (name === needle) return 900;
  if (name.startsWith(needle)) return 700;
  if (name.split(/[\s._:/-]+/).some((part) => part.startsWith(needle))) return 500;
  return name.includes(needle) ? 300 : 0;
}

export function ftsQuery(text: string): string {
  return [...new Set(words(text))].slice(0, 32).map((word) => `"${word}"`).join(" OR ");
}

export function decay(lastUsedAt: number, now: number): number {
  return Math.pow(0.5, Math.max(0, now - lastUsedAt) / (3 * 86_400_000));
}
