# Public-source boundary

Scout has three layers: the public core, separate apps, and hosted services.
This repository, `oscout/scout`, owns the core that runs on each host. Its
interface is the terminal. It contains no web app.

## Ownership

| Layer | Owns | Depends on |
| --- | --- | --- |
| Public core | Runtime, protocol, harness adapters, session observation and extraction, CLI, TUI, host side of phone pairing | Public source and declared dependencies |
| Apps | Mac, iOS, Android, and web clients | Released public core packages and APIs |
| Hosted services | Account, relay, push, and managed-service behavior | Explicit core and client contracts |

The apps and hosted services are private. They are not required to install,
build, test, or use the core. Their availability and release schedules are
separate from core releases. Other developers can build clients without
adopting those apps or services.

## What belongs here

- the `scout` CLI, JSON output, MCP server, and bundled runtime;
- shared protocol types, identity grammar, routing and delivery contracts;
- the local runtime, persistence, service lifecycle, discovery, and mesh;
- harness adapters, observed sessions, extraction, and replayable session state;
- the Rust TUI and native services required by the runtime;
- phone pairing's host implementation, including its runtime controller;
- public integration contracts, terminal integrations, tests, documentation,
  and release tooling.

**Placeholder:** name the host-pairing package and its public exports after the
pairing move is merged. Pairing remains a core capability, not an app extension.

The core does not import app source or require an app checkout. Its npm artifact
contains no web client, app source, app assets, or private credentials. The Mac,
iOS, Android, and web apps are clients, not directories or packages in this
repository. Voice presentation and other app-owned interfaces stay with apps;
only native services needed by core commands belong here.

## Building clients and extensions

Clients use the protocol, runtime APIs, CLI JSON output, or MCP. The runtime is
host-side code; browser clients need a host service rather than importing the
runtime into a browser bundle. Clients submit commands to the runtime instead
of writing its database.

CLI extensions add explicitly installed verbs. They use public runtime APIs
and cannot replace built-in commands. The core does not define a shared web
shell, public baseline web app, or mandatory build-time UI composition layer.

`scout server` and `scout web` serve a web client only when the separate apps
layer supplies one. Without that client, they explain where the web app comes
from. A missing web app does not make the core incomplete. Core setup and
readiness checks assess the runtime independently of app health.

## One source for each component

Public core changes are made, reviewed, and released here. Apps consume exact
released public package versions. Apps do not copy core packages, mirror source
trees, or import unpublished implementation paths. Public core never imports
private code.

There is no source export, recurring cross-repository merge, or synchronization
step in the development contract. Move ownership instead of maintaining two
implementations. An app interface can change independently while consuming an
explicit core version.

## Runtime-owned working set

The runtime is the canonical writer of Scout-owned registry and coordination
records. Clients request a bounded, coherent working set: routable identities,
active work, and recent coordination records with the identities needed to
render them. They do not download or persist the lifetime registry as their own
source of truth.

An expired or invalidated client cache is rehydrated from the runtime. Older
conversation history uses bounded history APIs, not an ever-growing registry
payload. Read projections and caches do not gain write or routing authority.
The host phone context uses a 24-hour working set, coalesced reads, and a short
in-process TTL. Some rich host projections still read full snapshots. Those
paths need scoped, paginated reads; the time window has no enforced cardinality
or byte ceiling. Routine lifetime-history responses are a regression, not a
client cache format to preserve.

External harness transcripts remain observed source material. Indexing,
extraction, or display must not bulk-import them as canonical Scout messages.
Mesh provides reachability and coordination, not transcript replication,
filesystem synchronization, global consensus, or exactly-once delivery.
Scout assumes trusted local users and agents. This boundary does not establish
enterprise, compliance, or hardened untrusted multi-tenant readiness.

## Release invariants

1. Public packages are built from their canonical source in this repository.
2. Package metadata and provenance point to `oscout/scout` and the reviewed
   source commit.
3. The release tag, package versions, and registry artifacts agree.
4. Packages in a lockstep core release use one exact version.
5. Private consumers pin released core dependencies instead of copying source.
6. Core builds, focused tests, and packed-artifact checks need no private
   workspace or app source.
7. The packed CLI contains no app or web files. Installed web clients are
   separately supplied artifacts, not a hidden part of the core package.

The former five-package plan, including a public web package and a
zero-extension web distribution, is not this boundary. Do not use that plan to
infer the core package set or require a UI composition BOM. Consult the release
manifest and each package's supported exports for the exact released set.

## Moving code across the boundary

Move a coherent component with its tests, dependency declarations, license
metadata, and provenance. Update its consumer and remove the old copy. Review
mixed changes for private assets, credentials, internal endpoints, operational
data, and unsupported product claims before publishing.

Preserve published contracts or document a breaking change. Never leave a
public package pointing at source users cannot inspect.


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


## Publication status

The supported npm publish set remains protocol and CLI. The pairing package is
an internal core workspace package bundled into the CLI. Its closed module
exports and build support source-level consumers; a separate component-package
publication must have its own exact artifact and pack/install qualification.
This source split does not assert that private artifact adoption or a milestone
release has completed.
