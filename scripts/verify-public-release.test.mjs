import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifest, verifyPublicRelease } from './verify-public-release.mjs';

const version = '0.3.8';
const sha = 'a'.repeat(40);
const main = 'b'.repeat(40);
const repository = 'https://github.com/oscout/scout';
const api = 'https://api.github.com/repos/oscout/scout';
const hash = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
function archive(manifest) {
  const bytes = Buffer.from(JSON.stringify(manifest));
  const header = Buffer.alloc(512);
  header.write('package/package.json');
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  header.fill(32, 148, 156);
  header[156] = 48;
  const sum = [...header].reduce((a, b) => a + b, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return gzipSync(Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512 + 1024)]));
}
function fixture({ manifest = {}, receipt = value => value } = {}) {
  const routes = new Map();
  const packages = ['protocol', 'scout'].map(short => {
    const name = `@openscout/${short}`;
    const packed = archive({ name, version, gitHead: sha, repository: { url: `${repository}.git` }, ...manifest });
    const entry = { name, version, filename: `openscout-${short}-${version}.tgz`, size: packed.length,
      sha256: hash(packed), integrity: `sha512-${hash(packed, 'sha512', 'base64')}` };
    const tarball = `https://registry.npmjs.org/${name}/-/${short}-${version}.tgz`;
    routes.set(tarball, packed);
    routes.set(`https://registry.npmjs.org/${name}/${version}`, { name, version, gitHead: sha,
      repository: { url: `git+${repository}.git` }, dist: { tarball, integrity: entry.integrity } });
    routes.set(`https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`, { latest: version, dev: '0.3.6-dev.4' });
    return entry;
  });
  const receiptUrl = `${repository}/releases/download/v${version}/receipt.json`;
  const receiptBytes = Buffer.from(JSON.stringify(receipt({ schemaVersion: 1, repository, releaseVersion: version,
    releaseSha: sha, authority: 'local-signed', provenance: 'none', packages })));
  routes.set(receiptUrl, receiptBytes);
  routes.set(`${api}/releases/tags/v${version}`, { id: 123, tag_name: `v${version}`, draft: false, prerelease: false,
    assets: [{ name: 'receipt.json', browser_download_url: receiptUrl, size: receiptBytes.length }] });
  routes.set(`${api}/commits/v${version}`, { sha });
  routes.set(`${api}/commits/main`, { sha: main });
  routes.set(`${api}/compare/${sha}...${main}`, { status: 'ahead', merge_base_commit: { sha } });
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, undefined);
    const value = routes.get(url);
    return new Response(value === undefined ? '' : Buffer.isBuffer(value) ? value : JSON.stringify(value), { status: value === undefined ? 404 : 200 });
  };
  return { routes, requests, fetchImpl };
}
const run = data => verifyPublicRelease({ version, fetchImpl: data.fetchImpl, now: () => new Date('2026-10-12T00:00:00Z') });

test('verifies original public pair anonymously without requiring the separate native latest release', async () => {
  const data = fixture();
  const evidence = await run(data);
  assert.equal(evidence.status, 'verified');
  assert.equal(evidence.releaseSha, sha);
  assert.equal(evidence.packages.length, 2);
  assert.equal(evidence.provenance, 'none');
  assert.equal(evidence.checkedAt, '2026-10-12T00:00:00.000Z');
  assert.ok(data.requests.every(({ url }) => !url.endsWith('/releases/latest')));
  assert.ok(data.requests.filter(({ url }) => url.endsWith('.tgz')).every(({ options }) => options.redirect === 'error'));
});

test('retains only verified original tarballs for subsequent install smoke', async () => {
  const data = fixture();
  const directory = mkdtempSync(join(tmpdir(), 'scout-public-verifier-'));
  try {
    const evidence = await verifyPublicRelease({ version, artifactDir: directory, fetchImpl: data.fetchImpl });
    for (const entry of evidence.packages) {
      const file = readFileSync(join(directory, `openscout-${entry.name.split('/')[1]}-${version}.tgz`));
      assert.equal(hash(file), entry.sha256);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const value of [undefined, '0.3.8-dev.1', 'v0.3.8', '00.3.8', '0.3.8/anything']) {
  test(`rejects non-explicit stable version ${value}`, async () => {
    await assert.rejects(verifyPublicRelease({ version: value, fetchImpl: () => { throw new Error('network should not run'); } }), /explicit stable/);
  });
}
for (const [label, mutate, error] of [
  ['prerelease', d => { d.routes.get(`${api}/releases/tags/v${version}`).prerelease = true; }, /must be final/],
  ['draft', d => { d.routes.get(`${api}/releases/tags/v${version}`).draft = true; }, /must be final/],
  ['missing receipt', d => { d.routes.get(`${api}/releases/tags/v${version}`).assets = []; }, /canonical receipt/],
  ['duplicate receipt', d => { const r = d.routes.get(`${api}/releases/tags/v${version}`); r.assets.push(r.assets[0]); }, /canonical receipt/],
  ['retagged release', d => { d.routes.get(`${api}/commits/v${version}`).sha = main; }, /tag differs/],
  ['unreachable source', d => { d.routes.get(`${api}/compare/${sha}...${main}`).status = 'diverged'; }, /reachable/],
  ['incorrect merge base', d => { d.routes.get(`${api}/compare/${sha}...${main}`).merge_base_commit.sha = main; }, /reachable/],
  ['protocol latest stale', d => { d.routes.get('https://registry.npmjs.org/-/package/%40openscout%2Fprotocol/dist-tags').latest = '0.3.7'; }, /latest mismatch/],
  ['wrong gitHead', d => { d.routes.get('https://registry.npmjs.org/@openscout/scout/0.3.8').gitHead = main; }, /metadata mismatch/],
  ['wrong repository', d => { d.routes.get('https://registry.npmjs.org/@openscout/scout/0.3.8').repository.url = 'https://github.com/other/scout'; }, /metadata mismatch/],
  ['foreign tarball URL', d => { d.routes.get('https://registry.npmjs.org/@openscout/scout/0.3.8').dist.tarball = 'https://evil.example/package.tgz'; }, /metadata mismatch/],
  ['corrupt tarball', d => { const b = d.routes.get('https://registry.npmjs.org/@openscout/scout/-/scout-0.3.8.tgz'); b[20] ^= 1; }, /differs from receipt/],
  ['missing public metadata', d => { d.routes.delete(`${api}/commits/main`); }, /Public fetch failed/],
]) {
  test(`fails closed for ${label}`, async () => { const data = fixture(); mutate(data); await assert.rejects(run(data), error); });
}
for (const [label, mutate, error] of [
  ['wrong source identity', r => ({ ...r, repository: 'https://github.com/arach/openscout' }), /identity mismatch/],
  ['wrong receipt version', r => ({ ...r, releaseVersion: '0.3.7' }), /identity mismatch/],
  ['duplicate package set', r => ({ ...r, packages: [r.packages[0], r.packages[0]] }), /package set/],
  ['false provenance', r => ({ ...r, provenance: 'github-oidc' }), /authority\/provenance/],
  ['wrong package size', r => { r.packages[0].size += 1; return r; }, /differs from receipt/],
  ['wrong package hash', r => { r.packages[0].sha256 = 'f'.repeat(64); return r; }, /differs from receipt/],
  ['unsafe filename', r => { r.packages[0].filename = '../protocol.tgz'; return r; }, /Invalid receipt package/],
]) {
  test(`fails closed for ${label}`, async () => { await assert.rejects(run(fixture({ receipt: mutate })), error); });
}

test('rejects dishonest manifest even when receipt and metadata match its bytes', async () => {
  await assert.rejects(run(fixture({ manifest: { version: '0.3.7' } })), /Packed manifest mismatch/);
});
test('fails when latest changes while downloading', async () => {
  const data = fixture(); let count = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('%40openscout%2Fprotocol/dist-tags') && ++count === 2) return Response.json({ latest: '0.3.9' });
    return data.fetchImpl(url, options);
  };
  await assert.rejects(verifyPublicRelease({ version, fetchImpl }), /latest changed/);
});
test('refuses missing or invalid tar manifests without extracting anything', () => {
  assert.throws(() => readManifest(gzipSync(Buffer.alloc(1024))), /Missing package manifest/);
  assert.throws(() => readManifest(Buffer.from('not gzip')));
});

for (const gitHead of [undefined, 'c'.repeat(40)]) {
  test(`rejects packed manifest with ${gitHead ? 'wrong' : 'missing'} source`, async () => {
    await assert.rejects(run(fixture({ manifest: { gitHead } })), /Packed manifest mismatch/);
  });
}
