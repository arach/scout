# Disposable Bun Git-shape diagnostic

No Scout imports, runtime changes, qualification or production workaround.
The subject forces collection of two stdout FileSink writers during a priming
synchronous spawn, holds enough read-only FDs to match the observed height,
and writes 4 MiB through a retained stdout writer before the Git call. The
parent withholds stdout reads until 250 ms after `before-git` (5 s emergency
fallback), while always draining stderr. This makes stdout back-pressure at
Git entry an explicit condition. No child stderr/stdout redirection to files.

The target is `node:child_process.execFileSync('git', ['-C', fixture,
'rev-parse', '--abbrev-ref', 'HEAD'], {stdio:['ignore','pipe','ignore']})`.
It has no timeout, so the parent owns a 10 s process-group guard. The preceding
priming spawn has a 2 s timeout. The guard, not an unbounded runtime call,
limits every reproduction. Resource guards stop below 3 GiB disk or 20% free
memory. Linux snapshots read only kernel metadata and regular-file counts.
No arbitrary argv, environment values or regular-file paths are persisted.

The diagnostic replacement `ci.yml` runs exactly one old baseline then one
1.4.4 subject and preserves both outcomes. It is manually dispatched by the
coordinator. The separate pin-only branch runs the unchanged full CI; do not
confuse this small workflow with that qualification surface.

Interpret the Linux baseline as the intended reproduction only when all of:
post-prime collected=2; Git entry but no Git return; 10 s outer guard; a zombie
child; an armed ONESHOT socket in a captured epoll set. Inspect FD counts and
stdout registrations too. If that fails, record inconclusive, not a fix.
One successful 1.4.4 run after the failing baseline tests this forced shape,
not ordinary-suite incidence or qualification of other Bun-sensitive holds.

GC timing strategy adapted from the MIT-licensed regression in
https://github.com/oven-sh/bun/pull/44581; third-party license is adjacent.
