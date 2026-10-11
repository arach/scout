"use client";
/*
 * File view for the World · Modale preview and stash. Recreates Scout's own
 * renderers rather than inventing new ones:
 *   - code  → Shiki with the Scout palette, lifted from
 *             packages/web/client/screens/code/ShikiPane.tsx (the Code screen)
 *   - md/txt → TextDocumentSurface (copied beside this file)
 * Mounted imperatively by the engine through mountFileView().
 */
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import { createTextDocument, TextDocumentSurface } from "./text-document.tsx";
import { THEMES, isTheme, resolveThemeId, type ThemeId } from "./theme.ts";

/* Each entry code-splits into its own chunk; a grammar downloads only the
   first time a file of that language is opened. */
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  swift: () => import("@shikijs/langs/swift"),
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  css: () => import("@shikijs/langs/css"),
  scss: () => import("@shikijs/langs/scss"),
  html: () => import("@shikijs/langs/html"),
  xml: () => import("@shikijs/langs/xml"),
  markdown: () => import("@shikijs/langs/markdown"),
  yaml: () => import("@shikijs/langs/yaml"),
  toml: () => import("@shikijs/langs/toml"),
  rust: () => import("@shikijs/langs/rust"),
  go: () => import("@shikijs/langs/go"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  "objective-c": () => import("@shikijs/langs/objective-c"),
  java: () => import("@shikijs/langs/java"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  dart: () => import("@shikijs/langs/dart"),
  docker: () => import("@shikijs/langs/docker"),
  make: () => import("@shikijs/langs/make"),
  proto: () => import("@shikijs/langs/proto"),
};

const LANG_BY_EXT: Record<string, string> = {
  swift: "swift",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonl: "json",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  plist: "xml",
  entitlements: "xml",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  rs: "rust",
  go: "go",
  py: "python",
  rb: "ruby",
  sh: "shellscript",
  zsh: "shellscript",
  bash: "shellscript",
  sql: "sql",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  m: "objective-c",
  mm: "objective-c",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  dart: "dart",
  dockerfile: "docker",
  makefile: "make",
  proto: "proto",
};

function langFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name === "dockerfile") return "docker";
  if (name === "makefile") return "make";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return LANG_BY_EXT[ext] ?? null;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();

function highlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: Object.values(THEMES).map(t => t.shiki),
    langs: [],
    engine: createOnigurumaEngine(() => import("shiki/wasm")),
  });
  return highlighterPromise;
}

async function highlight(code: string, lang: string, themeId: ThemeId): Promise<string> {
  const core = await highlighter();
  if (!loadedLangs.has(lang)) {
    const grammar = await LANG_LOADERS[lang]();
    await core.loadLanguage(grammar as Parameters<HighlighterCore["loadLanguage"]>[0]);
    loadedLangs.add(lang);
  }
  return core.codeToHtml(code, {
    lang,
    theme: `wm-${themeId}`,
  });
}


function CodeView({ code, path }: { code: string; path: string }) {
  const lang = useMemo(() => langFor(path), [path]);
  const [themeId, setThemeId] = useState<ThemeId>(resolveThemeId());
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    const onTheme = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (isTheme(id)) setThemeId(id);
    };
    window.addEventListener("wm-theme", onTheme);
    return () => window.removeEventListener("wm-theme", onTheme);
  }, []);
  useEffect(() => {
    setHtml(null);
    if (!lang || !LANG_LOADERS[lang]) return;
    let cancelled = false;
    highlight(code, lang, themeId).then(out => { if (!cancelled) setHtml(out); }).catch(() => {});
    return () => { cancelled = true; };
  }, [code, lang, themeId]);
  // Shiki output is fully escaped; file contents never reach the DOM raw.
  if (html) return <div className="fv-code" dangerouslySetInnerHTML={{ __html: html }} />;
  const lines = code.split("\n");
  return (
    <div className="fv-code">
      <pre className="shiki"><code>{lines.map((l, i) => <span className="line" key={i}>{l}{i < lines.length - 1 ? "\n" : ""}</span>)}</code></pre>
    </div>
  );
}

function FileView({ path, text }: { path: string; text: string }) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (ext === "md" || ext === "markdown" || ext === "mdx") {
    const doc = createTextDocument({ id: path, title: name, uri: path, value: text, filename: name, kind: "markdown", readOnly: true });
    return <TextDocumentSurface document={doc} mode="preview" className="fv-doc" />;
  }
  if (langFor(path)) return <CodeView code={text} path={path} />;
  const doc = createTextDocument({ id: path, title: name, uri: path, value: text, filename: name, kind: "text", readOnly: true });
  return <TextDocumentSurface document={doc} mode="read" className="fv-doc" />;
}

/** Render a text file into el with Scout's renderers; returns an unmount. */
export function mountFileView(el: HTMLElement, path: string, text: string): () => void {
  const root = createRoot(el);
  root.render(<FileView path={path} text={text} />);
  return () => setTimeout(() => root.unmount(), 0);
}
