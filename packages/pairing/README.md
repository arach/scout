# Host pairing

This core package owns `scout pair`, the pairing controller, the encrypted
phone bridge, and the host-side RPC projections used by paired devices.

The bridge has one implementation. It retains the web bridge procedures and
the terminal bridge's `tail.events` subscription. The CLI uses the same host
service as the controller. Legacy import paths are temporary re-exports for
the app-tree removal step.

Pairing admission stays in the runtime's trust owner. A daemon restart does
not create a QR invitation. Discovery does not publish a pairing room.
The legacy Herdr permission-answer adapter retains its existing version,
claim, and audit guards; this move does not activate the newer public
host-attention answer kernel.

The `models` directory contains pure phone response projections and their
types, not a browser entry, component tree, or static client.
The package is internal to the core workspace and bundled into the CLI.
It adds no separate install-time dependency.

```sh
bun run --cwd packages/pairing check
bun run --cwd packages/pairing test
```
