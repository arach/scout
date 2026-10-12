# Linux menu usage study

Compare an LED ledger, a progress ledger and a capacity chart at 320–520px
menu widths. Dense mode uses one 28px line per quota window. Select a row for
capture and reset details, or compare the earlier pass.

This public example runs without the private Studio, React or a Next.js app.
All fixtures are synthetic, with a fixed observation time. It does not query
accounts, refresh limits, send Scout messages or change desktop QML. The
navigation and refresh labels show proposed placement, not implemented actions.

From a public Scout checkout:

```bash
bun examples/linux-usage/serve.ts
```

Open the printed loopback URL. `SCOUT_USAGE_STUDY_PORT` changes the port. Query
parameters `scenario=pressure|missing`, `width=320`, `accent=phosphor` and
`density=earlier` select repeatable views. A phone viewport stacks the three
directions; the width control changes each menu sample.

Export a self-contained page with Bun alone:

```bash
bun examples/linux-usage/build.ts --out /tmp/scout-linux-usage.html
bun test examples/linux-usage/model.test.ts
```

The LED bank has twenty cells (5 percentage points per cell). The exact number
remains authoritative, and positive capacity lights at least one cell. Unknown
capacity has no fill; exhaustion shows zero. An absent capture is excluded from
the cached-sample count. Chart bars share a 0–100% scale, not a historical axis.
The numeric display rounds fractional capacity to one decimal; positive values
below 0.1% show `<0.1` and still light one LED cell.

The source derives from the October 2026 Linux usage study. Its local operator
snapshot was replaced with synthetic fixtures for the public boundary. This
example owns the reusable model and drawing; private product previews link here.

See [Linux notifications](../../docs/linux-desktop.md) and the
[Omarchy story](../../docs/blog/making-scout-at-home-on-omarchy.md).
