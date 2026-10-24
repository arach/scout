# Pairing runtime agent notes

Source: `packages/pairing` (`@openscout/pairing`), the core host-pairing package.
Verified against the core-only extraction on 2026-10-24. Phone apps are separate
clients. This is not broker routing or Scout messaging.

## Ownership

- `scout-base` reconciles durable pairing start/stop/restart intent.
- `src/pairing-runtime-controller.ts` bootstraps instance isolation and invokes
  `src/core/pairing/pairing-runtime-controller.ts`.
- `startPairingRuntime` owns the bridge, file server and relay connections.
- The bridge has one implementation. It retains the existing phone procedures,
  the `tail.events` subscription and the guarded legacy Herdr answer adapter.
- Runtime owns cryptography and canonical pairing trust. Pairing re-exports
  that owner; it has no independent trust writer.

The package is internal (`private: true`) and bundled into `@openscout/scout`.
It is not a separately published npm install. Its closed exports are `.`,
`/runtime`, `/controller`, `/terminal`, `/host`, `/http`, `/pair-requests`,
`/lan-beacon`, `/web-handoff` and `/artifacts`. Bun resolves source; ESM/types
resolve the declaration-bearing `dist` build.

## Consent and ingress

Daemon startup/restart permits trusted reconnects. It does not open a QR
opportunity. `scout pair` explicitly requests a fresh local opportunity; closing
that view cancels it. LAN owner approval uses a private, one-use opportunity
bound to its request and optional full Noise key. Discovery never publishes a
QR invitation. Reading an approved request is not successful delivery: the
shared store must win conditional fulfillment.

The existing bridge listener also mounts `/pair` and operator `/api/*` routes.
A remote `/pair` knock requests approval; it does not grant trust. Operator
routes require same-Mac peer identity and the runtime bearer token. Missing or
forwarded peer identity fails closed. There is no plaintext HTTP tRPC adapter,
browser entry or static client; `/` is 404.

Default production ports are bridge 43130, relay 43131 and file server 43132.
Instance bootstrap selects isolated dev roots and ports for source execution.
The controller writes its runtime snapshot/PID under the resolved pairing home,
not an app checkout. It owns LAN discovery even when using a remote relay.

## Verification

Use Bun and check free disk space before builds/tests. From the core root:

```sh
bun run --cwd packages/pairing check
bun run --cwd packages/pairing test
bun run test:pairing
```

The controller and CLI use the same host implementation. Other processes must
consume this core owner instead of restoring desktop or web source copies.
Physical phone/app integration requires its own artifact evidence; these source
and process fixtures do not certify a separately built app.
