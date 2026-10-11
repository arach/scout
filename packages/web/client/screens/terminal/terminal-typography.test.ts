import { describe, expect, test } from "bun:test";

import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  resolveTerminalTypography,
} from "./terminal-typography.ts";

describe("resolveTerminalTypography", () => {
  test("the default stack is set light", () => {
    expect(resolveTerminalTypography("")).toEqual({
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      fontSize: 13,
      fontWeight: 300,
    });
  });

  test("a legacy explicit family without a weight keeps the renderer's normal weight", () => {
    const typography = resolveTerminalTypography("?terminalFontFamily=Hack%20Nerd%20Font&terminalFontSize=15");
    expect(typography).toEqual({
      fontFamily: `'Hack Nerd Font', ${DEFAULT_TERMINAL_FONT_FAMILY}`,
      fontSize: 15,
    });
    expect(typography.fontWeight).toBeUndefined();
  });

  test("a host-forwarded default family carries its light weight", () => {
    expect(resolveTerminalTypography("?terminalFontFamily=JetBrainsMonoNL%20Nerd%20Font&terminalFontWeight=300")).toEqual({
      fontFamily: `'JetBrainsMonoNL Nerd Font', ${DEFAULT_TERMINAL_FONT_FAMILY}`,
      fontSize: 13,
      fontWeight: 300,
    });
  });

  test("only whole hundreds from 100 to 900 are honored as weights", () => {
    const family = "?terminalFontFamily=Menlo&terminalFontWeight=";
    for (const ignored of ["0", "50", "350", "1000", "bold", "300px", ""]) {
      expect(resolveTerminalTypography(`${family}${ignored}`).fontWeight).toBeUndefined();
    }
    expect(resolveTerminalTypography(`${family}100`).fontWeight).toBe(100);
    expect(resolveTerminalTypography(`${family}900`).fontWeight).toBe(900);
    expect(resolveTerminalTypography("?terminalFontWeight=nope").fontWeight).toBe(300);
  });

  test("quotes in an explicit family are escaped", () => {
    expect(resolveTerminalTypography("?terminalFontFamily=Bob's%20Mono").fontFamily)
      .toBe(`'Bob\\'s Mono', ${DEFAULT_TERMINAL_FONT_FAMILY}`);
  });

  test("sizes outside 9–32 fall back to 13", () => {
    expect(resolveTerminalTypography("?terminalFontSize=8").fontSize).toBe(13);
    expect(resolveTerminalTypography("?terminalFontSize=33").fontSize).toBe(13);
    expect(resolveTerminalTypography("?terminalFontSize=9").fontSize).toBe(9);
    expect(resolveTerminalTypography("?terminalFontSize=32").fontSize).toBe(32);
  });
});
