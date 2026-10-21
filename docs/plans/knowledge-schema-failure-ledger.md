# Knowledge schema failure ledger

Knowledge readers now serve an empty index while the on-disk schema is
incomplete. The writer publishes fresh schema tables in one transaction.
GET requests do not repair the on-disk schema.

## Failure and cause

Source: fork [CI run 9](https://github.com/arach/scout/actions/runs/39516024418)
on `core-split` at `bb15baf2d`.

The web test `background indexing returns at once and status follows the run`
failed when `/api/knowledge/status` called `listActiveJobs()` before the
`index_jobs` table existed. Hono returned an error response instead of JSON.

The deterministic reproduction confirms the proposed race:

1. Intercept the real writer constructor's `Database.exec` call.
2. Execute its schema prefix, stopping immediately before `CREATE TABLE IF NOT
   EXISTS index_jobs`.
3. Open a second, read-only connection before executing the remaining DDL.
4. Inspect `sqlite_master` and call `SQLiteKnowledgeStore.status()`.

Before the fix, the second connection sees `collections`, `chunks`, FTS and
other earlier tables. The old reader accepts that file because `collections`
exists. Status then throws `SQLiteError: no such table: index_jobs`, with the
same `listActiveJobs` → `status` call chain as CI. This reproduction does not
use polling, sleeps or a probabilistic stress loop.

## Failure ledger

| Exposure | Before | Resolution and check |
| --- | --- | --- |
| Fresh bootstrap, concurrent reader | Schema prefix is committed statement by statement; status throws on `index_jobs`. | Bootstrap DDL runs inside one transaction. The raw second connection sees no tables until commit. Status reads an empty in-memory index during the pause. |
| Interrupted bootstrap | An exception could leave an on-disk schema prefix. | A regression injects an exception at the same boundary. DDL rolls back, the writer lease releases, and a retry creates a usable store. |
| Existing partial or older cache | `collections` alone admits a reader even when other read tables are absent. | One `sqlite_master` query checks all nine logical tables. Any missing table selects the same empty in-memory fallback as a missing file. |
| Older cache without `warm_spans` or `storage_state` | These tables already have guards; their absence alone did not reproduce the CI exception. | Apply the same complete-schema rule to these caches. Reads are empty until a writer upgrades the cache. Existing rows remain on disk. The legacy storage test verifies that writer upgrade preserves its collection. |
| GET-side schema writes | A fallback must not migrate the cache. | The file opens read-only. Fallback DDL runs only in `:memory:`, then `query_only` is enabled. Runtime and HTTP regressions verify unchanged on-disk schema and schema version. |

## Implementation boundary

- Move `journal_mode = WAL` and `foreign_keys = ON` out of the schema string.
  SQLite cannot switch journal mode inside a transaction, and foreign-key
  enforcement must be enabled before a transaction begins.
- Wrap the fixed-size fresh bootstrap DDL in `Database.transaction`.
- Keep existing schema upgrades inside the storage budget's existing
  transaction and admission path.
- Require `collections`, `documents`, `chunks`, `chunks_fts`, `facets`,
  `source_refs`, `index_jobs`, `warm_spans` and `storage_state` for disk reads.
- Do not change the background-index polling test, its deadline or its delay.
- Do not add retries or DDL to the web routes.

The table check addresses missing tables, not arbitrary corrupt databases or
incompatible column definitions. Those errors are not silently converted into
an empty index.

## Verification

Initial reproduction, before production edits, on both Bun versions:
**1 pass, 10 fail** across 11 cases. Both the raw visibility check and the
status call fail deterministically. The final reproduction file adds one
rollback-and-retry case.

| Suite | Bun 1.3.13 | Bun 1.3.14 |
| --- | --- | --- |
| Runtime knowledge, including reproduction and rollback | 41 pass, 0 fail | 41 pass, 0 fail |
| Web knowledge routes, including original background-index test | 12 pass, 0 fail | 12 pass, 0 fail |

Commands, from the repository root:

```sh
bun test --isolate packages/runtime/src/knowledge.test.ts packages/runtime/src/knowledge
bun test --isolate packages/web/server/routes/knowledge-basic-search.test.ts packages/web/server/routes/knowledge-child-path.test.ts
bun run --cwd packages/runtime check
bun run --cwd packages/web check
```

For pinned Bun, prefix the commands with
`PATH="$HOME/.scout/work/tools/bun-1.3.13:$PATH"`. Runtime typechecking passed
on both versions. Web typechecking passed with no new errors.

Local evidence in the lane checkout:

- `tmp/knowledge-ci-run9-failed.log`: original CI failure.
- `tmp/knowledge-schema-before-bun1313.log` and
  `tmp/knowledge-schema-before-bun1314.log`: deterministic pre-fix failures.
- `tmp/knowledge-runtime-after-bun1313.log` and
  `tmp/knowledge-runtime-after-bun1314.log`: complete runtime knowledge batches.
- `tmp/knowledge-web-after-bun1313.log` and
  `tmp/knowledge-web-after-bun1314.log`: web knowledge batches.
- `tmp/knowledge-runtime-check-bun1313.log`,
  `tmp/knowledge-runtime-check-bun1314.log` and `tmp/knowledge-web-check.log`:
  typechecks.

These logs are local evidence, not published harness transcripts.
