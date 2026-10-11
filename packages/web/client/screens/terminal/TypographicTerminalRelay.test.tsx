import { describe, expect, mock, test } from "bun:test";
import type * as ReactModule from "react";
import type * as ReactJsxRuntimeModule from "react/jsx-runtime";
import type * as ReactJsxDevRuntimeModule from "react/jsx-dev-runtime";
import type * as ReactDomServerModule from "react-dom/server";

// Keep Bun on the runtime modules instead of the local TS declaration aliases.
// @ts-expect-error -- untyped relative runtime import
const React = (await import("../../../node_modules/react/index.js")) as typeof ReactModule;
// @ts-expect-error -- untyped relative runtime import
const ReactJsxRuntime = (await import("../../../node_modules/react/jsx-runtime.js")) as typeof ReactJsxRuntimeModule;
// @ts-expect-error -- untyped relative runtime import
const ReactJsxDevRuntime = (await import("../../../node_modules/react/jsx-dev-runtime.js")) as typeof ReactJsxDevRuntimeModule;
// @ts-expect-error -- untyped relative runtime import
const ReactDomServer = (await import("../../../node_modules/react-dom/server.node.js")) as typeof ReactDomServerModule;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

// Stand in for Hudson's relay and keep the props it receives.
const received: Record<string, unknown>[] = [];
mock.module("hudsonkit/terminal", () => ({
  TerminalRelay: (props: Record<string, unknown>) => {
    received.push(props);
    return null;
  },
}));

const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;
const { TypographicTerminalRelay } = await import("./TypographicTerminalRelay.tsx");

function relayPropsFor(search: string): Record<string, unknown> {
  received.length = 0;
  renderToStaticMarkup(createElement(TypographicTerminalRelay, { relay: {} as never, search }));
  expect(received).toHaveLength(1);
  return received[0]!;
}

describe("TypographicTerminalRelay", () => {
  test("the default face reaches TerminalRelay at weight 300", () => {
    expect(relayPropsFor("").fontWeight).toBe(300);
  });

  test("the native app's forwarded default family reaches TerminalRelay at weight 300", () => {
    const props = relayPropsFor("?terminalFontFamily=JetBrainsMonoNL%20Nerd%20Font&terminalFontWeight=300");
    expect(props.fontWeight).toBe(300);
    expect(String(props.fontFamily)).toStartWith("'JetBrainsMonoNL Nerd Font', ");
  });

  test("a legacy explicit family reaches TerminalRelay with no weight, so the renderer stays normal", () => {
    const props = relayPropsFor("?terminalFontFamily=Hack%20Nerd%20Font");
    expect(props.fontWeight).toBeUndefined();
    expect(props.renderer).toBe("auto");
  });
});
