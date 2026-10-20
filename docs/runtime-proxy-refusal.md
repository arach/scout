# Runtime HTTP proxy refusal

Connect remote clients directly to the runtime's authenticated mesh TLS
listener. Do not proxy Tailscale Serve, Funnel, or another HTTP relay to its
privileged loopback or Unix-socket listener.

The HTTP ingress gate refuses requests on physical local transports when they
carry `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`,
`X-Real-IP`, `Via`, `X-Forwarded-Port`, `CF-Connecting-IP`, `True-Client-IP`,
or a `Tailscale-*` header. Header presence, including an empty
value, is negative evidence only. It never authenticates a caller. Refusal is
HTTP 403 with `loopback_proxy_refused`. It precedes routing, local admin proof,
and verify-warn handling. The same rule refuses WebSocket upgrades.

## Why the refusal is at ingress

An HTTP proxy connects from loopback. Without protected local ingress, the
runtime otherwise treats that socket as local, regardless of the original
caller's network. A startup scan or doctor snapshot alone cannot enforce a
rule after proxy configuration changes. Per-request refusal handles HTTP
Serve/Funnel configuration added after startup without restarting a service.

The ingress posture report names this limited policy as
`localHttpProxyPolicy: "reject-forwarding-headers"`. It still reports observed
relay configuration and does not treat header rejection as authenticated
isolation or permission to activate scoped access.

## Source verification

Inspected Tailscale commit `47743a8b9ad16cf3a49504dc443208c37748072e`:
[`addProxyForwardedHeaders` and `addTailscaleIdentityHeaders`](https://github.com/tailscale/tailscale/blob/47743a8b9ad16cf3a49504dc443208c37748072e/ipn/ipnlocal/serve.go#L1088-L1127).
Its HTTP proxy sets forwarded host and source-address headers. HTTPS also
sets forwarded proto. Funnel sets its own request marker; tagged Serve
clients do not receive user-identity headers. The tests cover these distinct
profiles rather than requiring an optional user header.

Scout's local web service constructs new runtime requests with
`requestScoutBrokerJson` in `packages/web/server/core/broker/service.ts`.
Its GET helper passes socket path and signal; its POST helper passes method,
body, and socket path. Neither copies browser headers. Event-stream requests
also construct fresh headers. `packages/runtime/src/broker-api.ts` adds
accept/content-type headers. The regression suite exercises that client
against the real gate to preserve local web access. The separate phone relay
forwards selected headers to the web surface, not wholesale to the runtime.
The local tail/events WebSocket path in `packages/web/server/index.ts` also
constructs a new upstream connection to `/trpc` without browser headers. Its
peer-doorway branch forwards only selected headers to a peer web server, not
the local runtime. Vite asset proxying is a separate dev-server path.

Before extending the refusal set, a source inventory of Scout's local clients
confirmed that none sends `Via`, `X-Forwarded-Port`, `CF-Connecting-IP`, or
`True-Client-IP` to the runtime. The HTTP helper, CLI guest client and Python
transport construct their own headers; the web HTTP/event/WebSocket paths above
do not copy arbitrary browser headers to the runtime. Source occurrences of
`via` describe coordination or UI data, not outbound HTTP headers. This audit
does not cover third-party clients or external proxies.

## Limits

The separate [runtime-targeted Tailscale listener guard](runtime-tailscale-listener-guard.md)
uses fresh parsed config evidence to demote only the matched runtime listener,
including known raw TCP targets. Unknown/failed/stale probes are advisory only.

This HTTP rule is defense in depth for proxies that preserve forwarding evidence,
not proof that every relay is absent. Raw TCP forwarding and a proxy that
strips every marker are indistinguishable from a local client. Startup or
process/config scans cannot prove their absence either. Use cryptographically
protected local ingress for an authentication boundary on every local
transport; that existing mode treats uncredentialled local requests as remote.
Do not interpret this refusal as making arbitrary reverse proxies supported.
