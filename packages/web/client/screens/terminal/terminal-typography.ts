// WebKit's system monospace resolves to SF Mono. Named faces and Nerd Fonts
// provide fallbacks, including prompt glyphs the system face lacks. An explicit
// terminalFontFamily is always placed ahead of this stack.
export const DEFAULT_TERMINAL_FONT_FAMILY = "ui-monospace, 'SF Mono', SFMono-Regular, 'JetBrainsMono Nerd Font', 'JetBrainsMonoNL Nerd Font', 'MesloLGS Nerd Font Mono', 'Hack Nerd Font Mono', Menlo, monospace";

// The default face is set light, like the rest of the app. Bold cells keep the
// renderer's own bold weight.
export const DEFAULT_TERMINAL_FONT_WEIGHT = 300;

export type TerminalTypography = {
  fontFamily: string;
  fontSize: number;
  /** Undefined keeps the renderer's normal weight. */
  fontWeight?: number;
};

// A requested weight is honored only as a whole hundred from 100 to 900.
function terminalFontWeight(value: string | null): number | undefined {
  if (value === null || !/^[1-9]00$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

/**
 * Resolve the terminal face from `terminalFontFamily` / `terminalFontSize` /
 * `terminalFontWeight` query parameters. Without a family the default stack is
 * set light. A host that forwards its own default family says so with
 * `terminalFontWeight`; an explicit family without one renders at the
 * renderer's normal weight, as before.
 */
export function resolveTerminalTypography(search: string): TerminalTypography {
  const params = new URLSearchParams(search);
  const configuredFamily = params.get("terminalFontFamily")?.trim();
  const configuredSize = Number(params.get("terminalFontSize"));
  const configuredWeight = terminalFontWeight(params.get("terminalFontWeight"));
  const fontSize = Number.isFinite(configuredSize) && configuredSize >= 9 && configuredSize <= 32
    ? configuredSize
    : 13;
  if (configuredFamily) {
    return {
      fontFamily: `'${configuredFamily.replaceAll("'", "\\'")}', ${DEFAULT_TERMINAL_FONT_FAMILY}`,
      fontSize,
      ...(configuredWeight !== undefined ? { fontWeight: configuredWeight } : {}),
    };
  }
  return {
    fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize,
    fontWeight: configuredWeight ?? DEFAULT_TERMINAL_FONT_WEIGHT,
  };
}
