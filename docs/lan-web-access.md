# LAN-only access to Scout Web

This guide requires a web client supplied by the separate apps layer. The
public core ships no web app. App-specific server behavior below is not a
core-only installation contract.

A machine can publish its own `<name>.scout.local` address on the local network
and serve the web app to authenticated browsers without cloud or Tailscale
routing. This is an opt-in developer configuration. It requires Scout's
local Caddy edge, an active Ethernet/Wi-Fi IPv4 address, and mDNS reachability
between the devices. It does not configure routers or cross-VLAN discovery.

In `~/.openscout/config.json`, preserve existing settings and add:

```json
{
  "webLanScope": "full",
  "webLanOnly": true
}
```

`webLanScope` makes the full web surface reachable; it does not select the
basic/full client bundle or grant a browser access. `webLanOnly` restricts web
requests to this machine and the subnets of its physical Ethernet/Wi-Fi
interfaces. VPN, Tailscale, container and loopback interfaces do not define a
LAN subnet. Host, origin, credential and WebSocket checks still apply.

On a runtime containing this feature, `scout server restart` applies the web
settings. The base supervisor observes the LAN configuration and refreshes its
owned edge advertisements. An older runtime needs an updated base and web
server before enabling the option; setting an unknown JSON key alone does not
enforce any restriction.

## Names and connections

The machine's named doorway advertises its physical LAN address. `scout.local`
and `chat.scout.local` retain their existing local-machine semantics. Address
changes refresh only the base-owned mDNS children; losing IPv4 withdraws the
node advertisement. An available routable address is preferred over a
self-assigned IPv4 address. IPv6 clients are recognized by the network gate,
but node discovery currently requires a physical IPv4 address.

HTTP on the named doorway redirects to HTTPS. Caddy uses its existing local
certificate authority. Trust that machine's public CA certificate on the
browsing device, obtained through an already trusted path; the private CA key
stays on the serving machine. On macOS use a user trust entry for the SSL
policy. Chromium skips macOS trust entries constrained to a hostname, so such
an entry will not make Chrome trust the certificate. Trusting the machine's
CA for SSL also trusts other TLS certificates it signs; install only a CA
obtained from a machine you control. Scout never installs trust silently as
part of advertising a name. See Chromium's [macOS trust handling](https://chromium.googlesource.com/chromium/src/+/main/net/cert/internal/trust_store_mac.cc).

Use the existing `/login` page with the destination's operator credential to
create a revocable browser session. For this mode a remote login requires
HTTPS through the trusted local edge. Being on the LAN, knowing the hostname,
or having an AgentID identity does not grant operator access. A friendly
request-and-approve browser enrollment UI is a separate feature, not implied
by enabling these settings.

Browser authentication cookies are host-only. Login, same-machine bootstrap
and logout expire the former shared `Domain=scout.local` cookie. Each machine
therefore keeps its own session; portal and Chat obtain separate host cookies
through the existing same-machine bootstrap. Existing remote browsers may
need to sign in once after migration.

LAN-only serving does not proxy another machine's doorway through a tailnet or
cloud route. A foreign named host is rejected rather than serving local data
under the wrong name. This option controls Scout Web, not the runtime's separate
mesh listeners or other applications on the machine.

## Verification

Verify the node name resolves to its LAN address, HTTP redirects to HTTPS,
TLS validates without bypass, and a fresh browser cannot read protected APIs
or open authenticated WebSockets before login. After login, verify the
returned machine identity and an actual live Tail connection. A tailnet-origin
request must be rejected, including one supplying forged forwarding headers.
Removing the LAN route must not cause a tailnet/cloud fallback. Preserve the
before/after configuration and exact build receipts when installing a patch.
