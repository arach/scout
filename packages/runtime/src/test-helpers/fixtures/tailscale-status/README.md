# Tailscale status shape fixtures

These are synthetic values in the real `ServeConfig` JSON shape, not captures
of an operator tailnet. Source: Tailscale commit
`47743a8b9ad16cf3a49504dc443208c37748072e`:
- [ServeConfig, TCPPortHandler and HTTPHandler](https://github.com/tailscale/tailscale/blob/47743a8b9ad16cf3a49504dc443208c37748072e/ipn/serve.go)
- [serve status --json serializes GetServeConfig](https://github.com/tailscale/tailscale/blob/47743a8b9ad16cf3a49504dc443208c37748072e/cmd/tailscale/cli/serve_legacy.go#L620-L632)

`AllowFunnel` accompanies the same targets; it is not itself a forwarding
address. Foreground configs use the same nested shape. Unix paths and DNS
names here are fixture-only. `unparseable.txt` represents invalid command output.
