import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderAscii } from "@arach/arc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const diagrams = join(root, ".github", "diagrams");

function splice(relativePath, name, source, body) {
  const path = join(root, relativePath);
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const text = readFileSync(path, "utf8");
  if (!text.includes(start) || !text.includes(end)) {
    throw new Error(`${relativePath} is missing the ${name} markers`);
  }
  const block = `${start}\n\n<!-- Generated from ${source}. -->\n\n\`\`\`text\n${body}\n\`\`\`\n\n${end}`;
  writeFileSync(path, text.replace(new RegExp(`${start}[\\s\\S]*?${end}`), block));
}

// The control-plane flow is an Arc model.
const controlPlane = JSON.parse(readFileSync(join(diagrams, "control-plane.arc.json"), "utf8"));
splice(
  "README.md",
  "arc:control-plane",
  ".github/diagrams/control-plane.arc.json by @arach/arc",
  renderAscii(controlPlane, { maxWidth: 92 }),
);

// The layer map is drawn by hand: Arc's text renderer does not nest boxes.
const layers = readFileSync(join(diagrams, "layers.txt"), "utf8").trimEnd();
for (const path of ["README.md", "packages/cli/README.md", "docs/public-source-boundary.md"]) {
  splice(path, "diagram:layers", ".github/diagrams/layers.txt", layers);
}

console.log("rendered the control-plane and layer diagrams");
