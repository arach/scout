# Canonical attachment reads

Attachments bind content bytes to a committed message. Read them through
`POST /v1/attachments/read` with the existing conversation ID, message ID,
blob ID and mode. A hash alone is not read authority. The runtime checks current
actor authority, conversation membership, local message origin, binding and
content hash, then rechecks authority and the current binding after file I/O.

## Budgets

| Mode | Accepted content | Decoded source ceiling | Result |
| --- | --- | --- | --- |
| `text` | The canonical text/code MIME allowlist | 256 KiB (`readBytes`) | UTF-8 text, at most 32,000 characters; truncation and untrusted-source markers |
| `image` | PNG, JPEG, GIF, WebP | 25 MiB (`imageBytes`), matching image admission | Canonical base64 with message/blob ID, MIME and exact byte count |

The image read ceiling expands the behavior of the existing public endpoint.
Its request/result schema and authority rules do not change. There is no
privileged app flag: every authorized image-mode caller uses the same image
budget. Text tools keep the smaller text budget. Existing effective upload-request
limits also remain unchanged, including protected-ingress limits. HTML, SVG, MIME aliases and
other binary formats do not become readable through either mode.

A message whose origin belongs to another node is refused by this broker.
The existing signed host route can reach an attachment's owner only under its
existing verified peer/actor authority. It does not lend local operator rights
to a remote principal. Reads never fall back to an arbitrary URL, raw hash read
or legacy phone-store file.

## Memory and concurrency

Image results keep the existing base64 JSON representation so current app
clients can consume larger images without a new endpoint or transport rollout.
This is a bounded buffer, not a streaming API or a 25 MiB process-RSS ceiling.

- File reads allocate exactly the declared, validated byte count (at most
  25 MiB), read in at most 64 KiB operations, and use a one-byte EOF probe.
  A file that grows after `stat` cannot cause an unbounded `readFile` allocation.
  Short, extended, corrupt and symlinked files fail closed.
- Signature validation uses a view of those bytes rather than another full
  image copy. Hash and MIME/signature checks remain mandatory.
- One attachment service admits at most two image-mode reads through the final
  authorization recheck and base64 encoding. Additional image reads receive the
  existing `503 attachments_busy` refusal instead of retaining an unbounded
  queue of decoded images. The store also retains its existing serial I/O and
  two-operation admission bound.
- Base64 needs `4 * ceil(byteSize / 3)` characters, about 33.34 MiB at the image
  maximum. JSON serialization, transport and client decoding also need bounded
  representations of that response. These are additional memory costs; the
  read-admission bound is not a global limit on already-returned or slow-client
  HTTP responses.
- Signed-host image response parsing permits that base64 size plus 32 KiB of
  envelope/metadata. Text responses retain the 512 KiB transport ceiling.
  Both content-length and actual streamed bytes are bounded before JSON
  parsing. Transport fragments are coalesced into fixed-size pages, so tiny
  chunks cannot grow a per-chunk bookkeeping array without bound. Response
  identity, mode, MIME, decoded size, canonical base64 and content hash still
  have to match.

This constant-factor buffering is appropriate for the existing machine-local,
high-trust developer-pilot API and its admitted image maximum. It is not a
claim of untrusted multi-tenant readiness or globally bounded HTTP memory.
A streaming transport would require a separately reviewed public contract and
client rollout; increasing text inspection or adding new read authority is not
part of this image-budget change.
