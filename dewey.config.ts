import { readFileSync } from "node:fs";

const packageMetadata = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default {
  project: {
    name: "Scout",
    tagline: "Your personal agent cloud: a local control plane and mesh network.",
    type: "monorepo",
    version: packageMetadata.version,
  },

  agent: {
    criticalContext: [
      "This repository is the Scout core: runtime, protocol, harness adapters, session extraction, CLI, TUI, MCP server, native services, and the host side of phone pairing. The Mac, iOS, Android, and web apps and the hosted services are separate; never add app or UI source here. See docs/public-source-boundary.md.",
      "Use Bun 1.4.4 or newer for JavaScript and TypeScript workflows.",
      "The runtime is the canonical writer for Scout-owned coordination records; clients submit commands through its APIs.",
      "External harness transcripts are observed source material; never bulk-import them as Scout messages.",
      "One explicit target is a DM; group coordination requires an explicit channel; broadcast is opt-in.",
      "Use scout tell for updates and scout ask for requested work or replies.",
      "Mesh means reachability and coordination, not exactly-once delivery or global consensus.",
      "Scout assumes trusted local users and agents; do not claim enterprise or compliance readiness.",
      "Use gitmoji commit subjects and never add AI co-authoring footers.",
    ],

    entryPoints: {},

    rules: [
      { pattern: "packages/protocol/**", instruction: "Run bun run --cwd packages/protocol check." },
      { pattern: "packages/runtime/**", instruction: "Run bun run --cwd packages/runtime check and the narrow affected tests." },
      { pattern: "packages/pairing/**", instruction: "Run bun run --cwd packages/pairing check." },
      { pattern: "process spawning or shell execution", instruction: "Run bun run sync-exec:fence before committing shell-execution changes." },
    ],

    sections: ["overview", "quickstart", "extensions"],
  },

  docs: {
    path: "./docs",
    output: "./",
    required: ["overview", "quickstart", "extensions"],
  },

  install: {
    objective: "Install Scout and verify the local runtime.",
    doneWhen: {
      command: "scout doctor",
      expectedOutput: "A Scout readiness report with no blocking setup error.",
    },
    prerequisites: [
      "Bun 1.4.4 or newer",
      "macOS or Linux",
      "At least one supported coding-agent harness for routed work",
    ],
    steps: [
      { description: "Install the Scout CLI and bundled runtime", command: "npm install -g @openscout/scout" },
      { description: "Initialize local Scout state and services", command: "scout setup" },
      { description: "Verify local readiness", command: "scout doctor" },
      { description: "Confirm the inferred sender identity", command: "scout whoami" },
      { description: "List available targets", command: "scout who" },
    ],
  },
}
