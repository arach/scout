# Pinned v1 owner

`pairing-security/trust-owner.ts` is byte-identical to the owner at commit
`509c759556871be53ed4fa094fa9fd1e8a435712`.

SHA-256: `e0f650bacb7e72a413df1beb6520e136ba237feaf376500f5de77d0e9a6c4695`.

Do not reformat or patch it. Process tests import these exact bytes and instrument
filesystem calls outside the module. The support-path import shim resolves its
unchanged relative import. This fixture is not a runtime implementation or export.
