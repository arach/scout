import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stageExtensionChannel} from '../../runtime/scripts/stage-extension-channel.mjs';
const root = fileURLToPath(new URL('../../../',import.meta.url));
const run = (args,cwd=root) => spawnSync('bun',args,{cwd,encoding:'utf8',timeout:30000});
for (const bundled of [false,true]) test(`${bundled?'packed sidecar':'runtime ESM'} has fixed assets and refuses missing/tampered records outside checkout`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'scout-channel-artifact-'));
  try {
    if (!bundled) {
      const sources=['extension-channel-host','extension-channel-io','extension-channel-qualification','inherited-descriptors'];
      for(const name of sources){const build=run(['build',resolve(root,'packages/runtime/src',name+'.ts'),'--no-bundle','--target=bun','--outfile',join(dir,name+'.js')]);
      assert.equal(build.status,0,build.stderr);}
    }
    stageExtensionChannel(dir,bundled);
    const module=join(dir,`extension-channel-host.${bundled?'mjs':'js'}`);
    const script=`import{verifyExtensionChannelHostAssets,allocateExtensionChannel}from ${JSON.stringify(module)};
verifyExtensionChannelHostAssets();
if(Bun.revision==='0d9b296af33f2b851fcbf4df3e9ec89751734ba4'&&(process.platform==='darwin'&&process.arch==='arm64'||process.platform==='linux'&&process.arch==='x64'&&process.report.getReport().header.glibcVersionRuntime)){
const pair=allocateExtensionChannel('context');if(pair.target!==5)throw Error('wrong mapping');pair.source.close();pair.parent.close();console.log('allocated-and-closed');
}else{try{allocateExtensionChannel('context');throw Error('unqualified allocation');}catch(e){if(e.message!=='extension_channel_host_unavailable')throw e;}console.log('refused');}`;
    const positive=run(['-e',script],dir); assert.equal(positive.status,0,positive.stderr);assert.match(positive.stdout,/allocated-and-closed|refused/);
    const shim=join(dir,'extension-channel-native.c'), original=readFileSync(shim);
    writeFileSync(shim,Buffer.concat([original,Buffer.from('\n/* unapproved */')]));
    const check=`import{verifyExtensionChannelHostAssets}from ${JSON.stringify(module)};verifyExtensionChannelHostAssets();`;
    assert.notEqual(run(['-e',check],dir).status,0,'tampered C asset must refuse');
    writeFileSync(shim,original);rmSync(shim);assert.notEqual(run(['-e',check],dir).status,0,'missing asset must refuse');writeFileSync(shim,original);
    const manifest=join(dir,'extension-channel-artifact.json'), record=JSON.parse(readFileSync(manifest));
    record.adapter='0'.repeat(64);writeFileSync(manifest,JSON.stringify(record));
    assert.notEqual(run(['-e',check],dir).status,0,'fresh manifest cannot approve wrong source');
    record.adapter='c09006358ff0c37c831da027fe417d09c4f8c0b194230a5901d85a4837e4e62f';record.files['../escape']='0'.repeat(64);writeFileSync(manifest,JSON.stringify(record));
    assert.notEqual(run(['-e',check],dir).status,0,'unexpected manifest path must refuse');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('bundled CLI fixed host resolver loads its sibling; public gate remains false',()=>{
  const dir=mkdtempSync(join(tmpdir(),'scout-channel-resolver-'));
  try {
    stageExtensionChannel(dir,true);
    const main=join(dir,'main.mjs');
    const build=run(['build',resolve(root,'packages/cli/src/cli/extension-context-host.ts'),'--target=bun','--format=esm','--outfile',main]);assert.equal(build.status,0,build.stderr);
    const result=run(['-e',`import{scoutExtensionContextBackend,loadScoutExtensionChannelHost}from ${JSON.stringify(main)};if(scoutExtensionContextBackend()!==false)throw Error('gate opened');(await loadScoutExtensionChannelHost()).verifyExtensionChannelHostAssets();`],dir);
    assert.equal(result.status,0,result.stderr);
    rmSync(join(dir,'extension-channel-host.mjs'));assert.notEqual(run(['-e',`import{loadScoutExtensionChannelHost}from ${JSON.stringify(main)};await loadScoutExtensionChannelHost();`],dir).status,0,'no source-tree fallback');
    assert.ok(!readFileSync(main,'utf8').includes('bun:ffi'),'main must not inline the channel module');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
