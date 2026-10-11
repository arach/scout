import type { ComponentProps } from "react";
import { TerminalRelay } from "hudsonkit/terminal";

import { resolveTerminalTypography } from "./terminal-typography.ts";

type TypographicTerminalRelayProps = ComponentProps<typeof TerminalRelay> & {
  /** The page's query string, carrying any terminalFont* parameters. */
  search: string;
};

/** Hudson's TerminalRelay set in the face the query asks for. */
export function TypographicTerminalRelay({ search, ...props }: TypographicTerminalRelayProps) {
  const typography = resolveTerminalTypography(search);
  // "auto" lets Hudson load @xterm/addon-webgl and fall back to the DOM
  // renderer on context loss. Callers can still pin "dom" or "webgl".
  return (
    <TerminalRelay
      {...props}
      renderer={props.renderer ?? "auto"}
      fontFamily={typography.fontFamily}
      fontSize={typography.fontSize}
      fontWeight={typography.fontWeight}
    />
  );
}
