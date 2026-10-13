/** Sanitize nested tool outputs/inputs before JSON rendering as well as turns. */
export function stripHarnessValue(value: unknown): unknown {
  if (typeof value === "string") return stripHarnessBoilerplate(value);
  if (Array.isArray(value)) return value.map(stripHarnessValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, stripHarnessValue(entry)]));
  return value;
}

/** Harness-supplied prompt scaffolding is not session content. Also handles an
 * unterminated block (for example a truncated transcript record) fail-closed. */
export function stripHarnessBoilerplate(text: string): string {
  return text.replace(/<(recommended_plugins|local-command-caveat|system-reminder|system_reminder)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/giu, "").trim();
}
