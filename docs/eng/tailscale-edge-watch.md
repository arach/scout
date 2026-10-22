# Non-blocking Tailscale host refresh in base

Base awaits `readTailscaleSelfWebHosts()` before it builds edge configuration.
The five-second LAN watch joins a refresh already in flight. A cache miss no
longer holds the daemon's event loop inside a synchronous child wait.

## Reader contract

The asynchronous reader runs the same `status --json` argv as the retained
`readTailscaleSelfWebHostsSync` export. It keeps the 1500-ms default timeout and
positive `OPENSCOUT_TAILSCALE_STATUS_TIMEOUT_MS` override. Both output pipes are
captured, and the child receives no input. Command/read/parse failures return an
empty host list. A non-running backend also returns an empty list.

`OPENSCOUT_TAILSCALE_AUTO_HOSTS=0` starts no command. A configured status fixture
uses an asynchronous file read and bypasses the command cache. Malformed or
missing fixture files return no hosts. A custom environment object still needs
an explicit binary unless it supplies a fixture. As with the synchronous API,
that object selects reader options; it does not replace the child's inherited
process environment.

Both host APIs share **one completed-value cache**, including failures, with the
existing 30-second TTL and exact key: binary, raw auto-hosts value and raw timeout
value. Only calls with `env === process.env` use or populate that cache. A separate
async-only cache would create competing command streams and inconsistent failure
windows. The status-summary probe's separate policy is unchanged.

Concurrent asynchronous command reads with the same execution key share one
flight. Custom-environment calls can join that active flight, but never reuse or
populate the completed-value cache. Fixtures and disabled reads bypass flights.

The synchronous API keeps its fresh-on-miss contract. It cannot await a promise
on its own event loop. If an explicit synchronous caller runs during an async
cache miss, it can still issue a command; it does not return stale data or pretend
to join the promise. Sequence ordering prevents the older async completion from
overwriting a newer synchronous cache result. All direct base host-refresh paths now use the
asynchronous API, so those paths do not create that mixed-mode race. The broker
bootstrap and broker-URL helper keep their synchronous API unchanged. Base still
calls that URL helper once during configuration bootstrap; this is not a claim
that every startup Tailscale read has become asynchronous. This is process-local
coalescing, not cross-process coordination or a new child-tree custody protocol.

## Ownership after await

The base-private refresh helper captures the edge generation and child identity
before lookup. It reads current state again after lookup and before configuration
or effects. Shutdown, a stop, a different generation or a successor child refuses
the old result. A stopped edge cannot be restarted by its pending lookup.

Start and watch each have a single flight. The watch's callback observes failures,
and completed/rejected work releases its flight for the next request. Edge stop
invalidates the generation. A retired Caddy child's later exit cannot stop a
successor or invalidate a pending start that the earlier stop already fenced.

Broker trusted-host environment construction and web-start origin construction
also await explicit fresh-on-miss reads. Broker start is single-flight and checks
shutdown/child state after lookup. Web start checks shutdown after lookup. Neither
cold-start path uses an empty or stale-only host shortcut.

## Evidence and limits

The reader tests use a gated, owned fake executable. Its parent loop must release
the gate before lookup completion; the old synchronous control fails that ordering
assertion after the fixture proves it started. The production command budget is
not increased. The same suite checks success/failure caching, cache keys and TTL,
custom environments, fixtures, timeout/reaping and mixed sync/async cache ordering.

Base tests execute the actual start/watch/child-handler declarations with fake
bindings, without importing the daemon's boot side effects. They cover interval
coalescing, shutdown, generation/owner changes, failed work and retired-child exit.
No Caddy, mDNS, broker, app or live Tailscale service starts in these tests.

This conversion retires **zero synchronous symbol/file pairs**: the synchronous
export still has real callers. No fence allowance is removed or added. The existing
`tailscale.ts / node:child_process` pair also covers the async `execFile` import;
the synchronous `execFileSync` pair remains necessary. Report the all-pairs fence
and the synchronous-only census separately.
