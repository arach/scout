# Pinned v1 recursive closure

These files are byte-identical to commit
`509c759556871be53ed4fa094fa9fd1e8a435712`. Do not reformat, patch or stub them.
Their original relative imports resolve within this fixture, not to current code.
All bytes are committed so shallow CI does not need the old git object.

| Fixture file | SHA-256 |
| --- | --- |
| `pairing-security/trust-owner.ts` | `e0f650bacb7e72a413df1beb6520e136ba237feaf376500f5de77d0e9a6c4695` |
| `support-paths.ts` | `89bb061034a2e8ce7d11ca17c4db888744fd980d2a2e101ad8d4d2604298c6b1` |
| `instance.ts` | `22872b4328ff65c863308adaad4e2035b083ed6694c0ac8d8461e1a11a047f65` |

The old-reader/writer process worker verifies every file before import.
`pairing-v1-closure.test.ts` verifies the hashes and recursively walks the actual
imports, rejecting an unpinned dependency. Process tests execute this owner in
real migration races and pre/post-retirement refusal cases. This test fixture is
not a runtime implementation or package export.
