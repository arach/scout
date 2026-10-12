import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

export async function buildHtml(): Promise<string> {
  const bundle = await Bun.build({
    entrypoints: [new URL("./view.ts", import.meta.url).pathname],
    target: "browser",
  });
  if (!bundle.success) throw new Error(bundle.logs.join("\n"));
  const script = (await bundle.outputs[0].text()).replaceAll(
    "</script",
    "<\\/script",
  );
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const html = readFileSync(
    new URL("./template.html", import.meta.url),
    "utf8",
  );
  return html.replace("<!-- STYLE -->", `<style>${css}</style>`).replace(
    "<!-- SCRIPT -->",
    `<script type="module">${script}</script>`,
  );
}
if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (!values.out) {
    throw new Error(
      "Usage: bun examples/linux-usage/build.ts --out /absolute/index.html",
    );
  }
  const output = resolve(values.out);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, await buildHtml());
  console.log(output);
}
