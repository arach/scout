/** Bun 1.3.13 does not expose extra Node pipes at the reserved context target.
 * New hosts need independent transport qualification, not a version guess.
 * API 1 is deliberately outside this new capability gate.
 */
export function scoutExtensionContextBackend(): boolean {
  return typeof Bun !== "undefined" && Bun.revision === "0d9b296af33f2b851fcbf4df3e9ec89751734ba4"
    && (process.platform === "darwin" || process.platform === "linux");
}
