/** A passing named test plus an unrelated failure is not a caught control.
 * Runners must also check healthy exit, nonzero bypass exit and their own
 * boundary observations. This helper checks only the exact failure identity. */
export function namedControlFailed(log: string, expected: string): boolean {
  if (!expected || /Cannot find (?:module|package)|SyntaxError|ParseError|Test timed out|timed out after/i.test(log)) return false;
  return log.split(/\r?\n/).some(line => {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    return plain.startsWith("(fail) ") && plain.slice(7).includes(expected);
  });
}
