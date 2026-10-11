/**
 * World · file previews: which files may be served, and how.
 *
 * Shared by the web route (routes/world.ts) and the Studio route (design/studio/app/api/world-file). Transcript
 * membership alone never makes a file previewable: a file must also realpath inside an approved root — a session
 * cwd or repo root seen in the week, under the user's home, never home itself — and clear a hard deny list of
 * credential stores. Containment is re-checked on the realpath at open time, so a symlink inside a root that points
 * out of it is refused. Node built-ins only.
 */
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, relative, sep } from "node:path";

/* ---------- the deny list ---------- */
// home-relative prefixes: credential stores and agent state (transcripts carry secrets of their own)
const HOME_DENY = [
  ".ssh", ".aws", ".gnupg", ".config/gh", ".netrc", ".docker/config.json", ".kube", ".azure", ".config/gcloud",
  ".git-credentials", ".npmrc", ".pypirc", ".pgpass", ".claude/projects", ".codex/sessions", ".codex/auth.json", ".openscout",
];
// ~/Library is off limits except the app's own logs
const LIBRARY_ALLOW = ["Library/Application Support/OpenScout/logs"];
// any path segment, anywhere
const SEGMENT_DENY = new Set([".ssh", ".gnupg", ".aws", "Keychains", ".git"]);
const NAME_DENY = /^(?:\.env.*|.*\.(?:pem|key|p12|pfx|keystore|jks|keychain|keychain-db)|id_.*|credentials.*|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials)$/i;

const under = (child: string, root: string) => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);

/** True for a path the previews must never serve, whatever root it sits in. */
export function isDeniedPath(p: string, home: string): boolean {
  const segs = p.split(sep).filter(Boolean);
  if (segs.some(s => SEGMENT_DENY.has(s) || NAME_DENY.test(s))) return true;
  if (!under(p, home)) return false;
  const rel = relative(home, p);
  if (HOME_DENY.some(d => rel === d || rel.startsWith(d + "/"))) return true;
  if (rel === "Library" || rel.startsWith("Library/")) return !LIBRARY_ALLOW.some(a => rel === a || rel.startsWith(a + "/"));
  return false;
}

export type WorldFilePolicy = {
  /** realpath'd approved roots */
  roots: string[];
  /** The realpath to serve, or null: absolute, normalized, realpath inside an approved root, not denied, a regular file. */
  check(p: unknown): Promise<string | null>;
};
const expand = (p: string, home: string) => p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p;
const real = (p: string) => realpath(p).catch(() => null);

/** Approved roots from the week's session cwds and repo roots (tilde or absolute). */
export async function createWorldFilePolicy(home: string, candidateRoots: Iterable<string>): Promise<WorldFilePolicy> {
  const homeReal = await real(home) ?? home;
  const roots = new Set<string>();
  for (const c of new Set(candidateRoots)) {
    if (!c) continue;
    const abs = expand(c, home);
    if (!isAbsolute(abs)) continue;
    const r = await real(abs);
    if (!r || r === homeReal || !under(r, homeReal) || isDeniedPath(r, homeReal)) continue;
    roots.add(r);
  }
  const list = [...roots];
  return {
    roots: list,
    async check(p) {
      if (typeof p !== "string" || !p || p.includes("\0") || !isAbsolute(p) || normalize(p) !== p) return null;
      if (isDeniedPath(p, home) || isDeniedPath(p, homeReal)) return null;
      const r = await real(p);
      if (!r || !list.some(root => under(r, root)) || isDeniedPath(r, homeReal)) return null;
      try { return (await stat(r)).isFile() ? r : null; } catch { return null; }
    },
  };
}

/* ---------- response headers ---------- */
/** Every preview response: no scripts, an opaque origin, nothing loaded from elsewhere. */
export const PREVIEW_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'";
const IMAGE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
// documents the browser would render rather than embed: a top-level open gets their source as text
const TOP_LEVEL = new Set(["document", "iframe", "frame", "embed", "object"]);

/**
 * How to serve a preview of `file`. `fetchDest` is the request's Sec-Fetch-Dest. Images go out as images (an <img>
 * never runs SVG script); an SVG opened top-level or framed is served as its text. HTML, XML and everything else is
 * text/plain. PDFs keep their type under the same sandbox CSP (Chrome's viewer renders them, checked 2026-10-10).
 */
export function previewKind(file: string, fetchDest: string | null | undefined): { binary: boolean; headers: Record<string, string> } {
  const ext = basename(file).slice(basename(file).lastIndexOf(".") + 1).toLowerCase();
  const base = { "x-content-type-options": "nosniff", "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer" };
  if (ext === "pdf") return { binary: true, headers: { ...base, "content-type": "application/pdf", "content-security-policy": PREVIEW_CSP } };
  if (IMAGE[ext] && !(ext === "svg" && fetchDest && TOP_LEVEL.has(fetchDest))) return { binary: true, headers: { ...base, "content-type": IMAGE[ext], "content-security-policy": PREVIEW_CSP } };
  return { binary: false, headers: { ...base, "content-type": "text/plain; charset=utf-8", "content-security-policy": PREVIEW_CSP } };
}
