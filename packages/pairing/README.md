# Host pairing

This core package owns `scout pair`, the pairing controller, the encrypted
phone bridge, and the host-side RPC projections used by paired devices.

The bridge has one implementation. It retains the web bridge procedures and
the terminal bridge's `tail.events` subscription. The CLI uses the same host
service as the controller. Its existing bridge listener mounts the host pairing
HTTP routes; the controller owns LAN discovery even with a remote relay.
Apps can reuse these mounts, but pairing does not require an app listener or
a browser client. The unauthenticated route is the existing `/pair` knock.
Operator HTTP routes require a same-Mac request and the runtime bearer token.

Pairing admission stays in the runtime's trust owner. A daemon restart does
not create a QR invitation. Discovery does not publish a pairing room.
The legacy Herdr permission-answer adapter retains its existing version,
claim, and audit guards; this move does not activate the newer public
host-attention answer kernel.

The `models` directory contains pure phone response projections and their
types, not a browser entry, component tree, or static client.
The package is internal to the core workspace and bundled into the CLI.
It adds no separate install-time dependency. The closed export map supports
Bun source loading and a declaration-bearing dist build for core consumers.

```sh
bun run --cwd packages/pairing check
bun run --cwd packages/pairing test
```

The former desktop bridge now uses the existing broker receipt-backed
native-session reply procedure instead of its unsupported-operation stub.
Receipt validation and refusal behavior are owned by the broker. This is an
intentional unification of the former web and desktop procedure sets, not a
new input authority.
