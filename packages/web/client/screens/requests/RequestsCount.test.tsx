import { expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const runtime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const devRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => runtime);
mock.module("react/jsx-dev-runtime", () => devRuntime);
const { RequestsCount } = await import("./RequestsCount.tsx");

test("the actual sidebar badge is neutral at zero and signal only above zero", () => {
  const render = (count: number) => renderToStaticMarkup(React.createElement(RequestsCount, { count, navigation: true }));
  expect(render(0)).toContain('data-attention="false"');
  expect(render(0)).toContain('>0</span>');
  expect(render(1)).toContain('data-attention="true"');
  expect(render(1)).toContain('scout-requests-nav-count');
});
test("an initial unknown count does not masquerade as an orange request", () => {
  const markup = renderToStaticMarkup(React.createElement(RequestsCount, { count: 0, pending: true }));
  expect(markup).toContain('data-attention="false"');
  expect(markup).toContain('>—</span>');
});


test("the badge stylesheet scopes orange to the positive-count selector", async () => {
  const css = await Bun.file(new URL("./requests.css", import.meta.url)).text();
  expect(css).toContain('.scout-requests-count[data-attention="true"]');
  expect(css).toContain('background: var(--signal)');
  const neutralRule = css.match(/\.scout-requests-count, \.scout-requests-nav-count \{([^}]+)\}/)?.[1];
  expect(neutralRule).toContain("color: var(--hud-muted)");
  expect(neutralRule).not.toContain("--signal");
});
