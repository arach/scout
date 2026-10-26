#!/usr/bin/env node
// Read-only reconciliation of a previously published stable release. Never rebuilds,
// publishes, promotes tags, or executes code from downloaded packages.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'https://github.com/openscout-app/scout';
const api = 'https://api.github.com/repos/openscout-app/scout';
const names = ['@openscout/protocol', '@openscout/scout'];
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const normalizedRepository = value => typeof value === 'string' ? value.replace(/^git\+/, '').replace(/\.git$/, '') : '';

// Inspect one regular-file manifest in memory: no extraction and no lifecycle scripts.
export function readManifest(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  let manifest;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/s, '');
    const sizeText = field(124, 136).trim();
    assert(/^[0-7]+$/.test(sizeText), 'Invalid tar entry size');
    const size = parseInt(sizeText, 8);
    const sum = [...header].reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert(sum === parseInt(field(148, 156).trim(), 8), 'Invalid tar header checksum');
    const entry = [field(345, 500), field(0, 100)].filter(Boolean).join('/');
    assert(offset + 512 + size <= tar.length, 'Truncated tar entry');
    if (entry === 'package/package.json') {
      assert(manifest === undefined, 'Duplicate package manifest');
      assert(header[156] === 0 || header[156] === 48, 'Package manifest must be a regular file');
      manifest = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString('utf8'));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert(manifest !== undefined, 'Missing package manifest');
  return manifest;
}

export async function verifyPublicRelease({ version, artifactDir, fetchImpl = globalThis.fetch, now = () => new Date() }) {
  assert(stable.test(version ?? ''), 'An explicit stable X.Y.Z version is required');
  const tag = `v${version}`;
  async function bytes(url, limit, redirects = false) {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: redirects ? 'follow' : 'error',
      headers: { Accept: 'application/json', 'User-Agent': 'scout-public-release-verifier', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(60_000),
    });
    assert(response.status === 200, `Public fetch failed (${response.status}): ${url}`);
    assert(Number(response.headers.get('content-length') ?? 0) <= limit, `Response too large: ${url}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      assert(size <= limit, `Response too large: ${url}`);
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  const json = async url => JSON.parse((await bytes(url, 8 * 1024 * 1024)).toString('utf8'));
  const release = await json(`${api}/releases/tags/${tag}`);
  assert(release.tag_name === tag && release.draft === false && release.prerelease === false,
    'GitHub release must be final and match the requested stable tag');
  const receiptUrl = `${repository}/releases/download/${tag}/receipt.json`;
  const assets = release.assets?.filter(asset => asset.name === 'receipt.json') ?? [];
  assert(assets.length === 1 && assets[0].browser_download_url === receiptUrl, 'Exactly one canonical receipt.json asset is required');
  const receiptBytes = await bytes(receiptUrl, 1024 * 1024, true);
  assert(assets[0].size === receiptBytes.length, 'Receipt asset size differs from GitHub metadata');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert(receipt.schemaVersion === 1 && receipt.repository === repository && receipt.releaseVersion === version
    && /^[0-9a-f]{40}$/.test(receipt.releaseSha ?? ''), 'Receipt release identity mismatch');
  assert(['local-signed', 'github-oidc'].includes(receipt.authority)
    && receipt.provenance === (receipt.authority === 'github-oidc' ? 'github-oidc' : 'none'), 'Receipt authority/provenance mismatch');
  assert(Array.isArray(receipt.packages) && receipt.packages.length === names.length
    && new Set(receipt.packages.map(entry => entry.name)).size === names.length
    && names.every(name => receipt.packages.some(entry => entry.name === name)), 'Receipt package set mismatch');
  const source = await json(`${api}/commits/${tag}`);
  assert(source.sha === receipt.releaseSha, 'Public release tag differs from receipt source');
  const main = await json(`${api}/commits/main`);
  assert(/^[0-9a-f]{40}$/.test(main.sha ?? ''), 'Public main source is invalid');
  const ancestry = await json(`${api}/compare/${receipt.releaseSha}...${main.sha}`);
  assert(['ahead', 'identical'].includes(ancestry.status) && ancestry.merge_base_commit?.sha === receipt.releaseSha,
    'Receipt source must be reachable from public main');
  const verified = [];
  const downloads = [];
  for (const name of names) {
    const entry = receipt.packages.find(value => value.name === name);
    const short = name.split('/')[1];
    assert(entry.version === version && entry.filename === `openscout-${short}-${version}.tgz`
      && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 64 * 1024 * 1024
      && /^[a-f0-9]{64}$/.test(entry.sha256 ?? '') && /^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? ''),
    `Invalid receipt package: ${name}`);
    const packageUrl = `https://registry.npmjs.org/${name}`;
    const tags = await json(`https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`);
    assert(tags.latest === version, `npm latest mismatch: ${name}`);
    const record = await json(`${packageUrl}/${version}`);
    const tarballUrl = `${packageUrl}/-/${short}-${version}.tgz`;
    assert(record.name === name && record.version === version && record.gitHead === receipt.releaseSha
      && normalizedRepository(record.repository?.url) === repository && record.dist?.integrity === entry.integrity
      && record.dist?.tarball === tarballUrl, `npm metadata mismatch: ${name}`);
    const packed = await bytes(tarballUrl, entry.size);
    assert(packed.length === entry.size && digest(packed) === entry.sha256
      && `sha512-${digest(packed, 'sha512', 'base64')}` === entry.integrity,
    `Published tarball differs from receipt: ${name}`);
    const manifest = readManifest(packed);
    assert(manifest.name === name && manifest.version === version && manifest.gitHead === receipt.releaseSha
      && normalizedRepository(manifest.repository?.url) === repository, `Packed manifest mismatch: ${name}`);
    downloads.push({ filename: entry.filename, bytes: packed });
    verified.push({ name, version, latest: tags.latest, gitHead: record.gitHead, tarballUrl,
      size: packed.length, sha256: entry.sha256, integrity: entry.integrity, manifestVerified: true });
  }
  // Re-read moving pointers after byte verification; fail if promotion raced us.
  for (const name of names) {
    const tags = await json(`https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`);
    assert(tags.latest === version, `npm latest changed during verification: ${name}`);
  }
  if (artifactDir) {
    mkdirSync(artifactDir, { recursive: true });
    for (const item of downloads) writeFileSync(resolve(artifactDir, item.filename), item.bytes, { flag: 'wx' });
  }
  return { schemaVersion: 1, status: 'verified', checkedAt: now().toISOString(), repository,
    version, tag, releaseSha: receipt.releaseSha, publicMainSha: main.sha, releaseId: release.id,
    releaseUrl: `${repository}/releases/tag/${tag}`, receiptUrl, receiptSha256: digest(receiptBytes),
    authority: receipt.authority, provenance: receipt.provenance, packages: verified,
    scope: 'Anonymous public distribution verification of existing artifacts; does not prove installed clients updated.' };
}

async function cli(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    assert(['--version', '--output', '--artifact-dir'].includes(args[index]) && args[index + 1]
      && options[args[index]] === undefined, 'Usage: bun scripts/verify-public-release.mjs --version X.Y.Z --output evidence.json [--artifact-dir directory]');
    options[args[index]] = args[index + 1];
  }
  assert(options['--output'], '--output is required');
  const output = resolve(options['--output']);
  // Remove a stale success receipt before attempting verification.
  rmSync(output, { force: true });
  const evidence = await verifyPublicRelease({ version: options['--version'], artifactDir: options['--artifact-dir'] });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, output);
  } finally { rmSync(temporary, { force: true }); }
  console.log(JSON.stringify(evidence, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli(process.argv.slice(2)).catch(error => { console.error(`Public release verification failed: ${error.message}`); process.exitCode = 1; });
}
