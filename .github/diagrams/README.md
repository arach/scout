# Scout diagrams

Two diagrams are rendered into the docs as README-safe monospace text:

| Source | Shows | Rendered into |
| --- | --- | --- |
| `control-plane.arc.json` | How a request flows through the runtime | `README.md` |
| `layers.txt` | What lives in the core, the apps and the hosted services | `README.md`, `packages/cli/README.md`, `docs/public-source-boundary.md` |

The control-plane diagram is an editable
[`@arach/arc`](https://www.npmjs.com/package/@arach/arc) model. The layer map is
drawn by hand, because Arc's text renderer does not nest boxes. Edit a source,
then refresh every rendered copy:

```bash
bun run diagram:readme
```

Commit each source with its refreshed copies. The rendered blocks are plain
text so they stay legible in GitHub light and dark themes, on npm, in
terminals, in copied agent context, and for `llms.txt` consumers.
