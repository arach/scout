# Runtime mesh ping

Custody decides origin. Machine/node-key signatures originate in the runtime.
Clients may make user-key-signed, unsigned and public-tier calls directly. SSH
uses the user's SSH policy. This route is not a general proxy.

`POST /v1/mesh/ping {"target":"peer"}` is local tier, including protected-mode
local authentication. The target is a runtime node ID, exact node name or exact
hostname. Unknown and ambiguous targets are refused. A signed probe requires a
single active, unexpired peer grant with an enrolled TLS SPKI pin, a node in
this runtime's mesh, and an HTTPS origin from that node's runtime-owned table.
Unpinned peers must be enrolled with TLS before using authenticated ping.

The runtime fetches and verifies the signed node card over pinned TLS before
signing a fixed `GET /v1/node`. Key ID, node ID and TLS pin must match the known
peer. Trust and route membership are rechecked after card I/O, before signing.
Pin or identity failures never fall back to unsigned or alternate identities.

A raw HTTP(S) origin is always an unsigned public `GET /v1/node` reachability
check, even if that origin is also a known peer. Userinfo, paths, query strings,
fragments and non-HTTP schemes are refused. No caller headers or body are sent.
Redirects are not followed. The response contains status and timing, never the
upstream body or transport error text.

This check lets a local caller learn whether a supplied address answers from
this runtime's network, including private addresses. It does not establish peer
identity. The local tier and request bounds limit access and cost; they do not
remove this network-reachability information. Do not expose this route remotely.

Limits: ten requests per minute per runtime, one in flight, three candidate
origins, two seconds per candidate and six seconds total. Each candidate has
at most one card request and one signed request. Raw URLs get one request.
Each response is limited to 64 KiB, including chunked/decompressed bodies.
The Node pinned connector caps its buffer before constructing a response;
Bun streaming bodies are capped and cancelled by the ping reader.
