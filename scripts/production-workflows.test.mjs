import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
    const result = spawnSync('bash', ['-c', `set -euo pipefail; gh() { printf '%s\\n' "$@"; }; VERSION="$1"; TAG="v$1"; GITHUB_REPOSITORY=openscout-app/scout; ${snippet}`, '--', version], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.split('\n').includes('--prerelease'), prerelease);
    assert.ok(result.stdout.includes('--latest=false'));
  }
});
test('MCP Registry publication lists stable releases only, through GitHub OIDC and a pinned publisher', () => {
  const source = workflow('publish-mcp-registry');
  assert.match(source, /release:\s+types: \[published\]/);
  assert.match(source, /permissions:\s+contents: read\s+id-token: write/);
  assert.match(source, /!github\.event\.release\.prerelease/);
  assert.match(source, /mcp-publisher login github-oidc/);
  assert.match(source, /MCP_PUBLISHER_SHA256: "[0-9a-f]{64}"/);
  assert.match(source, /sha256sum -c -/);
  assert.doesNotMatch(source, /secrets\./);
  assert.ok(source.indexOf('Wait for the npm package') < source.indexOf('Publish to the MCP Registry'));
  const start = source.indexOf('          if [[ ! "$TAG"');
  const snippet = source.slice(start, source.indexOf('>> "$GITHUB_OUTPUT"\n\n', start) + '>> "$GITHUB_OUTPUT"'.length);
  const dir = mkdtempSync(join(tmpdir(), 'scout-registry-workflow.'));
  try {
    for (const [tag, publish] of [['v0.4.3', true], ['v1.0.0', true], ['v0.4.3-dev.1', false], ['0.4.3', false], ['v0.4', false]]) {
      const output = join(dir, tag);
      const result = spawnSync('bash', ['-c', `set -euo pipefail; TAG="$1"; GITHUB_OUTPUT="$2"; ${snippet}`, '--', tag, output], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, 'utf8').includes('publish=true'), publish, tag);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
