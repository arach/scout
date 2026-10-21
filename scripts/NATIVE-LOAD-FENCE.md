# Native library load fence

`bun run sync-exec:fence` inventories native `dlopen` references in the same
TypeScript/TSX source roots as the execution fence (`packages` and `apps`).
A native load requires a `dlopen` symbol/category entry in
`sync-exec-allowlist.json`, with an owner, reason and explicit `libraryPaths`.

Each call must name a reviewed, normalized **absolute path literal**. Sonames,
relative paths, cwd/environment/configuration-derived paths, interpolation and
unreviewed absolute paths refuse. Aliases and escaping `dlopen` references also
refuse; a file allowlist is not permission to select another library at runtime.
The parser covers direct, member, element and parenthesized calls. Comments and
text containing the word are not native loads. This is a static review fence,
not a sandbox against arbitrary reflection or hostile native code. New native
APIs and indirection still require review.

The current entries cover the staged supervision SDK's flock/errno binding,
read-only process evidence, read-only SIGCHLD query and an isolated test setter.
Darwin loads use the fixed libSystem/libproc paths, including dyld-cache-backed
libraries. The Linux lock binding tries only fixed glibc paths for x64/arm64
(Debian multiarch and `/lib64`). Unknown layouts refuse
`ownership_lock_unsupported`; there is no soname/environment fallback. No library
path is accepted from a request, extension manifest or host configuration.

Importing the SDK does not load these libraries. An explicit native capability
call or custody store operation loads only its reviewed binding. The SIGCHLD
probe never changes a disposition. Only the standalone native-test fixture
sets one, and it refuses import into another entrypoint. Tests execute the
fence in an owned temporary source tree; none of the fixture load expressions
are evaluated.
