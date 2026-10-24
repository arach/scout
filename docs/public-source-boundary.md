# Public-source boundary

Scout is the public core. It owns the protocol, runtime, harness adapters,
session extraction, CLI, TUI, and host side of phone pairing. It has no web app.

## Three layers

| Layer | Source ownership |
| --- | --- |
| Core | Public `oscout/scout`: the code required on every host |
| Apps | OpenScout apps: web, macOS, iOS, and Android interfaces at every account level |
| Hosted services | OpenScout apps for now |

Apps consume exact released core artifacts. The core never imports or requires
an apps checkout. The React trace presentation layer belongs with apps; the
headless session trace model remains in core. Private credentials, operational data, product artwork, and
hosted-service implementation stay outside this repository.

## Host pairing

`packages/pairing` owns one encrypted bridge implementation, its runtime
controller, the existing phone RPC projections, approval-request store,
pairing HTTP route mount, and LAN beacon. Security primitives and the trust
owner remain in `packages/runtime`.

The CLI and controller use the same implementation. Pairing does not require a
web client. The existing bridge listener mounts the host pairing routes, and
the controller owns the LAN beacon. Operator HTTP routes require both a
same-Mac request and the runtime bearer token. The unauthenticated `/pair`
knock requests approval; it does not grant consent. Apps can reuse those route
mounts. Core adds no second web application or plugin API.

A daemon restart does not grant pairing consent. Discovery does not publish a
QR invitation. The legacy Herdr permission-answer adapter retains its existing
version, claim, and audit guards; moving it does not activate a newer authority.

## Optional web app

The npm CLI contains no web server, browser client, app assets, or compatibility
web bundle. A reused build directory is cleaned before packaging.

Apps select their server through `OPENSCOUT_WEB_SERVER_ENTRY` or the existing
instance-scoped app-service configuration. No source-tree or stale installed
bundle is discovered implicitly. An explicitly installed client is selected only
for the matching version. Without apps, web commands explain where the web app
comes from rather than claiming to serve a basic fallback.

There is no pairing add-on, extension-context cutover gate, or rollback window
in this ownership decision. Release adoption and hosted CI remain explicit
checkpoints, not claims made by a source move.

## Broker-owned working set

The broker is the canonical owner of live registry and coordination state.
Control-plane clients must not download or persist the broker's lifetime
registry as their own source of truth. They request a bounded, coherent working
set instead: current routable agents and endpoints, active work, and a recent
window of coordination records with the referenced identities needed to render
it.

The host phone context path already asks the broker for a 24-hour working
set, coalesces concurrent reads, and keeps the result behind a short in-process
TTL. An expired or invalidated cache is rehydrated from the broker. Conversation
history outside that working set is loaded through its dedicated bounded APIs,
not by growing the registry payload.

This migration is not complete. Some rich host projections still have
full-snapshot reads, and the time-windowed projection is not yet protected by an
explicit cardinality or byte ceiling. Those paths must move to scoped,
paginated broker reads before this boundary can be considered enforced. A
routine registry response that returns lifetime history or grows to tens of
megabytes is a regression, not a cache format clients should preserve.

## Release invariants

The public split is trustworthy only when a release can be traced back to the
source a user can inspect. The release workflow should enforce these invariants:

1. all public package manifests use one version;
2. public npm packages are built only from their canonical source in this
   repository;
3. the release tag points at that source commit;
4. npm provenance and package metadata point back to `oscout/scout`;
5. the npm `latest` version and its tagged public source do not drift silently;
6. private consumers pin exact, lockstep public package versions rather than
   copying source or importing unpublished internals;
7. public CI verifies the source boundary without private-workspace
   dependencies.

Version drift between npm and its public tagged source is a release blocker—not
something to fix by editing version strings alone. A private product may
deliberately consume an older public-core revision, but that revision must be
explicit and its source must remain canonical here.

## Publication status

The supported npm publish set remains protocol and CLI. The pairing package is
an internal core workspace package bundled into the CLI. Its closed module
exports and build support source-level consumers; a separate component-package
publication must have its own exact artifact and pack/install qualification.
This source split does not assert that private artifact adoption or a milestone
release has completed.
