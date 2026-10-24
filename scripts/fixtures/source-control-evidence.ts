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

/** Standalone worker assertions need the actual highlighted statement and
 * AssertionError, not merely an expected string printed in source context. */
export function assertionControlFailed(log: string, statement: string, message: string): boolean {
  if (!statement.trim() || !message.trim()
    || /Cannot find (?:module|package)|SyntaxError|ParseError|Test timed out|timed out after|pause not reached|settled before pause/i.test(log)) return false;
  const plain = log.replace(/\x1b\[[0-9;]*m/g, "");
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^\\s*\\d+\\s*\\|\\s*" + escape(statement.trim())
    + "\\s*\\r?\\n\\s*\\^+\\r?\\nAssertionError(?: \\[ERR_ASSERTION\\])?: "
    + escape(message) + "(?:\\r?\\n|$)", "m").test(plain);
}
