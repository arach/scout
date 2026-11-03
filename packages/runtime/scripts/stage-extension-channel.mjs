import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, copyFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = resolve(root, 'packages/runtime/src');
const adapter = '5ecc869eabb149398fd3ba231c15d14d421fc09151ec843f12e17d8ef7eb9fd8';
const shim = '6cb286471315213e7f5015a8fd1c0b2f38de2284b687a7c74d2f7c4e273437f0';
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
/** A fresh manifest never approves changed inputs. Both anchors are reviewed constants. */
export function stageExtensionChannel(output, bundled = false) {
  if (digest(resolve(source,'extension-channel-io.ts')) !== adapter || digest(resolve(source,'extension-channel-native.c')) !== shim) throw Error('extension channel qualification source changed');
  mkdirSync(output, {recursive:true});
  if (bundled) {
    const result = spawnSync('bun', ['build',resolve(source,'extension-channel-host.ts'),'--target=bun','--format=esm','--outfile',resolve(output,'extension-channel-host.mjs')], {stdio:'inherit'});
    if (result.status !== 0) throw Error('extension channel sidecar build failed');
  }
  copyFileSync(resolve(source,'extension-channel-native.c'),resolve(output,'extension-channel-native.c'));
  const files = bundled ? ['extension-channel-host.mjs','extension-channel-native.c'] : ['extension-channel-host.js','extension-channel-io.js','extension-channel-qualification.js','inherited-descriptors.js','extension-channel-native.c'];
  const record = {schema:'scout.extension-channel-artifact/v1',ruling:'fable-a-reuse-compile-isolation/v1',adapter,shim,
    version:'1.3.14',revision:'0d9b296af33f2b851fcbf4df3e9ec89751734ba4',platforms:['darwin-arm64','linux-glibc-x64'],
    files:Object.fromEntries(files.map(file=>[file,digest(resolve(output,file))]))};
  writeFileSync(resolve(output,'extension-channel-artifact.json'),JSON.stringify(record,null,2)+'\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) stageExtensionChannel(resolve(root,'packages/runtime/dist'));
