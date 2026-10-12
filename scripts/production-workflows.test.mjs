import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const workflow = name => readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
test('only stable npm publication records a Production deployment while dev retains signing access', () => {
  assert.match(workflow('release-package-npm'), /environment:\s+name: Production\s+#.*\n\s+deployment: \$\{\{ inputs.npm_tag == 'latest' \}\}/);
});
test('production reconciliation is manual, read-only and verifies before reporting success', () => {
  const source = workflow('verify-production-release');
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /permissions:\s+contents: read/);
  assert.match(source, /group: release-package-npm/);
  assert.ok(source.indexOf('Verify stable release identity') < source.indexOf('Install verified package'));
  assert.ok(source.indexOf('Recheck stable pointers') < source.indexOf('Retain production verification'));
  assert.match(source, /--ignore-scripts/);
  assert.doesNotMatch(source, /npm publish|dist-tag add|deployments: write|id-token: write/);
});
test('TUI-created dev releases are prereleases, stable releases are not', () => {
  const source = workflow('release-scout-tui');
  const snippet = source.slice(source.indexOf('            prerelease=(--prerelease=false)'), source.indexOf('\n          fi', source.indexOf('            prerelease=(--prerelease=false)')));
  for (const [version, prerelease] of [['0.3.8', false], ['0.3.6-dev.3', true]]) {
    const result = spawnSync('bash', ['-c', `set -euo pipefail; gh() { printf '%s\\n' "$@"; }; VERSION="$1"; TAG="v$1"; GITHUB_REPOSITORY=oscout/scout; ${snippet}`, '--', version], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split('\n').includes('--prerelease'), prerelease);
    assert.ok(result.stdout.includes('--latest=false'));
  }
});
