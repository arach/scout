# Provider quota observations

`scout providers` reads `/v1/provider-quotas` from the selected runtime broker.
It does not read the web service-budget API, bootstrap browser cookies or poll
providers. Existing CLI-wide broker maintenance is unchanged; this consumer
port does not establish cold-start or app-absence independence.

```sh
scout providers usage --cached --json
scout providers usage
scout providers map --role implementation --cached --json
```

## Refresh and provenance

The existing default and `--refresh` request refresh, but the runtime reports
`refresh: "unsupported"`. The command prints that limitation. `--cached` makes
no refresh request and reports `refresh: "not_requested"`. Neither mode changes
capture timestamps, polls an account or opens a dashboard. Usage `generatedAt`
is the runtime read time, not proof of a newly captured provider measurement.
Map's top-level timestamp is recommendation computation time; `quotaRead` keeps
the runtime read time.

Usage JSON has schema `scout.provider-usage/v1`. Each provider row represents one
observed pool: provider, account, user, endpoint, native session, harness,
transport and plan. IDs remain opaque and case-sensitive. Different accounts,
endpoints or sessions never combine into one row. If account identity is
unknown, each observation remains separate rather than claiming a shared pool.
`poolId` is the row key; `id` retains the original provider ID and can repeat.
Each window retains its original public `facts`, including capture time, age,
source and observation provenance, alongside formatted percentages and times.
Missing identity is `null`, not an inferred account.

No new selector flags are introduced. The existing `usage`, `map`, `--refresh`,
`--cached` and `--role` grammar is retained. Per-account/endpoint selection is
unsupported in this increment; a multi-pool map refuses rather than choosing
one. Coverage and truncation metadata remain visible.

## Unknown and stale data

A successful read without approved observations produces explicit
`availability: "unknown"`, not zero percentages or a successful empty-quota
claim. Text says unknown rather than `0 windows`. An HTTP refusal, missing route
or unavailable runtime remains an error with its HTTP status; it does not become
an unknown/empty success or retry through the web app. Malformed or inconsistent
quota payloads are refused instead of being coerced into zero usage.

The CLI labels facts older than one hour, or whose reset time has passed, as
stale. Waiting and requesting refresh cannot make an observation younger.
Stale-only usage has `availability: "stale"` and preserves historical values and
timestamps. With a mix of fresh and stale facts, usage retains all rows and
labels each stale window; `available` means some fresh facts, not complete
coverage or fresh data for every provider.

## Map safety

Map refuses missing facts, incomplete coverage, missing account/endpoint
identity, any stale observed window, unsupported routing providers, or more
than one observed pool for a routing provider. It never averages accounts or
lets the last account silently win. Inspect `providers usage` to see each pool. Per-pool map selection needs a
separate reviewed CLI change. A user ID does not substitute for an account ID.

The current routing policy uses `codex` for `openai` observations and `claude`
for `anthropic` observations. Usage retains the original provider ID. Other
providers without observations retain the policy's unknown/probe-first guidance,
not invented zero-usage facts. Future observed providers stay visible in usage
but require a matching routing policy before mapping.

Map JSON retains the usage report as `quotaRead`, names its exact
observation basis in `quotaBasis`, and sets `accountBinding: "not_enforced"`.
Text prints the same account/endpoint provenance and limitation. This is a
recommendation, not account-bound dispatch or a durable role assignment.
