import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync, mkdirSync, cpSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {stageExtensionChannel} from '../../runtime/scripts/stage-extension-channel.mjs';
const root = fileURLToPath(new URL('../../../',import.meta.url));
const run = (args,cwd=root) => spawnSync('bun',args,{cwd,encoding:'utf8',timeout:30000});
for (const bundled of [false,true]) test(`${bundled?'packed sidecar':'runtime ESM'} has fixed assets and refuses missing/tampered records outside checkout`,()=>{
  const dir=mkdtempSync(join(tmpdir(),'scout-channel-artifact-'));
  try {
    let emitter={kind:'bun-build'};
    if (!bundled) {
      // Emit with the production TypeScript compiler/options, not Bun's
      // transpiler: the runtime's actual ESM factory is the evidence target.
      const require=createRequire(resolve(root,'packages/runtime/package.json'));
      const ts=require('typescript'),runtime=resolve(root,'packages/runtime');
      const config=ts.readConfigFile(join(runtime,'tsconfig.json'),ts.sys.readFile);
      assert.equal(config.error,undefined);
      const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,runtime,undefined,join(runtime,'tsconfig.json'));
      const sources=['extension-channel-host','extension-channel-io','extension-channel-qualification','inherited-descriptors'].map(name=>join(runtime,'src',name+'.ts'));
      const program=ts.createProgram(sources,{...parsed.options,outDir:dir});
      const diagnostics=ts.getPreEmitDiagnostics(program);
      assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:x=>x,getCurrentDirectory:()=>root,getNewLine:()=>"\n"}));
      assert.equal(program.emit().emitSkipped,false);
      emitter={kind:'typescript',version:ts.version,node:process.version};
    }
    stageExtensionChannel(dir,bundled);
    let assets=dir;
    if(bundled) {
      const manifest=JSON.parse(readFileSync(resolve(root,'packages/cli/package.json')));
      assert.ok(manifest.files.includes('dist'),'CLI package must ship the channel payload');
      const staging=join(dir,'package'),dist=join(staging,'dist');mkdirSync(dist,{recursive:true});
      for(const file of ['extension-channel-host.mjs','extension-channel-native.c','extension-channel-artifact.json']) {
        copyFileSync(join(dir,file),join(dist,file));rmSync(join(dir,file));
      }
      writeFileSync(join(staging,'package.json'),JSON.stringify(manifest));
      const archive=join(dir,'scout-channel-payload.tgz');
      const pack=spawnSync('tar',['-czf',archive,'-C',dir,'package'],{encoding:'utf8'});assert.equal(pack.status,0,pack.stderr);
      rmSync(staging,{recursive:true});const unpack=join(dir,'unpacked');mkdirSync(unpack);
      const extract=spawnSync('tar',['-xzf',archive,'-C',unpack],{encoding:'utf8'});assert.equal(extract.status,0,extract.stderr);
      assets=join(unpack,'package/dist');
    }
    const module=join(assets,`extension-channel-host.${bundled?'mjs':'js'}`);
    const builder=run(['-e','console.log(JSON.stringify({version:Bun.version,revision:Bun.revision,platform:process.platform,arch:process.arch}))']);assert.equal(builder.status,0,builder.stderr);
    console.log(JSON.stringify({event:'channel-artifact',mode:bundled?'unpacked-cli-channel-payload':'runtime-esm',emitter,executionHost:JSON.parse(builder.stdout),record:JSON.parse(readFileSync(join(assets,'extension-channel-artifact.json')))}));
    const script=`import * as host from ${JSON.stringify(module)};
if(Object.keys(host).sort().join()!=='allocateExtensionChannel,verifyExtensionChannelHostAssets')throw Error('unexpected public channel export');
const {verifyExtensionChannelHostAssets,allocateExtensionChannel}=host;
verifyExtensionChannelHostAssets();
if(Bun.revision==='0d9b296af33f2b851fcbf4df3e9ec89751734ba4'&&(process.platform==='darwin'&&process.arch==='arm64'||process.platform==='linux'&&process.arch==='x64'&&process.report.getReport().header.glibcVersionRuntime)){
const pair=allocateExtensionChannel('context');if(pair.target!==5)throw Error('wrong mapping');pair.source.close();pair.parent.close();console.log('allocated-and-closed');
}else{try{allocateExtensionChannel('context');throw Error('unqualified allocation');}catch(e){if(e.message!=='extension_channel_host_unavailable')throw e;}console.log('refused');}`;
    const positive=run(['-e',script],dir); assert.equal(positive.status,0,positive.stderr);assert.match(positive.stdout,/allocated-and-closed|refused/);
    // Compile the real executor/instrument into a test-only harness. Its factory
    // MUST come from the installed artifact, never a hidden source-tree import.
    const witness=join(dir,'runner-witness.mjs');
    const compiled=run(['build',resolve(root,'scripts/extension-numeric-spike/runner-witness.ts'),'--target=bun','--format=esm','--outfile',witness]);assert.equal(compiled.status,0,compiled.stderr);
    if(positive.stdout.includes('allocated-and-closed')) {
      const disposition=run(['-e',`import{allocateExtensionChannel}from ${JSON.stringify(module)};process.on('SIGPIPE',()=>{});try{const p=allocateExtensionChannel('context');p.source.close();p.parent.close();throw Error('SIGPIPE policy accepted');}catch(error){if(error.nativeCode!==-3)throw error;console.log('sigpipe-refused');}`],dir);
      assert.equal(disposition.status,0,disposition.stderr);assert.equal(disposition.stdout.trim(),'sigpipe-refused');
      const faults={none:null,'stale-second-close':'reclaimed descriptor lost','second-spawn-close':'replacement spawn descriptor lost','finalizer-close':'finalizer closed runtime-owned number',mapping:'child mapping failed',eof:'child EOF failed',cloexec:'CLOEXEC copy discipline failed','collection-retained':'native subprocess collection was not observed within 64 GC rounds','cancel-double-close':'reclaimed descriptor lost'};
      for(const [fault,reason] of Object.entries(faults)) {
        const measured=run([witness,fault,module],dir);
        assert.equal(measured.status,reason?1:0,measured.stdout+measured.stderr);assert.equal(measured.stderr,'');
        const events=measured.stdout.trim().split('\n').map(line=>JSON.parse(line));
        if(reason){assert.equal(events.at(-1).event,'failure');assert.match(events.at(-1).error,new RegExp(reason));}
        else {assert.equal(events.filter(e=>e.event==='native-collected').length,9);assert.equal(events.filter(e=>e.event==='second-spawn-reuse').length,1);assert.ok(events.filter(e=>e.event==='reclaim-check').length>=160);assert.equal(events.at(-1).event,'complete');}
      }
    }
    const shim=join(assets,'extension-channel-native.c'), original=readFileSync(shim);
    writeFileSync(shim,Buffer.concat([original,Buffer.from('\n/* unapproved */')]));
    const check=`import{verifyExtensionChannelHostAssets}from ${JSON.stringify(module)};verifyExtensionChannelHostAssets();`;
    assert.notEqual(run(['-e',check],dir).status,0,'tampered C asset must refuse');
    writeFileSync(shim,original);rmSync(shim);assert.notEqual(run(['-e',check],dir).status,0,'missing asset must refuse');writeFileSync(shim,original);
    const manifest=join(assets,'extension-channel-artifact.json'), record=JSON.parse(readFileSync(manifest));
    record.adapter='0'.repeat(64);writeFileSync(manifest,JSON.stringify(record));
    assert.notEqual(run(['-e',check],dir).status,0,'fresh manifest cannot approve wrong source');
    record.adapter='c09006358ff0c37c831da027fe417d09c4f8c0b194230a5901d85a4837e4e62f';record.files['../escape']='0'.repeat(64);writeFileSync(manifest,JSON.stringify(record));
    assert.notEqual(run(['-e',check],dir).status,0,'unexpected manifest path must refuse');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('bundled CLI fixed host resolver loads its sibling; context gate is coordinate-bound',()=>{
  const dir=mkdtempSync(join(tmpdir(),'scout-channel-resolver-'));
  try {
    stageExtensionChannel(dir,true);
    const main=join(dir,'main.mjs');
    const build=run(['build',resolve(root,'packages/cli/src/cli/extension-context-host.ts'),'--target=bun','--format=esm','--outfile',main]);assert.equal(build.status,0,build.stderr);
    const result=run(['-e',`import{scoutExtensionContextBackend,loadScoutExtensionChannelHost}from ${JSON.stringify(main)};const expected=Bun.version==='1.3.14'&&Bun.revision==='0d9b296af33f2b851fcbf4df3e9ec89751734ba4'&&(process.platform==='darwin'&&process.arch==='arm64'||process.platform==='linux'&&process.arch==='x64'&&!!process.report.getReport().header.glibcVersionRuntime);if(scoutExtensionContextBackend()!==expected)throw Error('gate coordinate mismatch');(await loadScoutExtensionChannelHost()).verifyExtensionChannelHostAssets();`],dir);
    assert.equal(result.status,0,result.stderr);
    rmSync(join(dir,'extension-channel-host.mjs'));assert.notEqual(run(['-e',`import{loadScoutExtensionChannelHost}from ${JSON.stringify(main)};await loadScoutExtensionChannelHost();`],dir).status,0,'no source-tree fallback');
    assert.ok(!readFileSync(main,'utf8').includes('bun:ffi'),'main must not inline the channel module');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('unpacked production CLI entry dispatches context-only; credentials and bad assets refuse',()=>{
  const dir=mkdtempSync(join(tmpdir(),'scout-context-cli-'));
  try {
    const staging=join(dir,'package'),dist=join(staging,'dist');mkdirSync(dist,{recursive:true});
    stageExtensionChannel(dist,true);
    // Same entry, target, outdir and banner as scripts/build.mjs. The other
    // product services are not needed for this package-slice acceptance test.
    const build=run(['build',resolve(root,'packages/cli/src/main.ts'),'--target=bun','--outdir',dist,'--banner=import "reflect-metadata";']);
    assert.equal(build.status,0,build.stderr);
    const main=join(dist,'main.mjs');copyFileSync(join(dist,'main.js'),main);rmSync(join(dist,'main.js'));
    const text=readFileSync(main,'utf8');
    assert.ok(!text.includes('runScoutExtensionWithQualifiedContext'),'no post-gate test seam in product');
    assert.ok(!text.includes('bun:ffi'),'native helper must remain a separate lazy sidecar');
    const manifest=JSON.parse(readFileSync(resolve(root,'packages/cli/package.json')));
    writeFileSync(join(staging,'package.json'),JSON.stringify(manifest));
    const archive=join(dir,'cli.tgz');
    assert.equal(spawnSync('tar',['-czf',archive,'-C',dir,'package']).status,0);
    rmSync(staging,{recursive:true});
    const unpack=join(dir,'unpacked');mkdirSync(unpack);
    assert.equal(spawnSync('tar',['-xzf',archive,'-C',unpack]).status,0);
    // Install the declared public dependency in the isolated package, not by
    // falling through to checkout node_modules. No source-tree sibling exists.
    const require=createRequire(resolve(root,'packages/cli/package.json'));
    const reflect=dirname(require.resolve('reflect-metadata'));
    assert.equal(JSON.parse(readFileSync(join(reflect,'package.json'))).version,manifest.dependencies['reflect-metadata']);
    cpSync(reflect,join(unpack,'package/node_modules/reflect-metadata'),{recursive:true});
    const entry=join(unpack,'package/dist/main.mjs'), home=join(dir,'home'), fixture=join(dir,'provider');
    mkdirSync(home);mkdirSync(fixture);
    const env={HOME:home,PATH:process.env.PATH,SCOUT_HOME:join(home,'scout'),OPENSCOUT_HOME:join(home,'legacy'),
      OPENSCOUT_EXTENSIONS_HOME:join(home,'extensions'),OPENSCOUT_INSTANCE:'prod',SCOUT_DIST_KEY:'synthetic-must-not-deliver',
      OPENSCOUT_BROKER_URL:'http://127.0.0.1:43110',SCOUT_EXTENSION_CHANNEL_HOST:'/missing-override.mjs'};
    const invoke=(args,input)=>spawnSync('bun',[entry,...args],{cwd:dir,env,input,encoding:'utf8',timeout:20000});
    const declaration={context:'scout.extension-context/v1',requires:['selection/v1','distribution.endpoint/v1']};
    const writeDeclaration=(invocation)=>writeFileSync(join(fixture,'extension.json'),JSON.stringify({api:2,command:'run',version:'1.0.0',invocation}));
    writeDeclaration(declaration);
    writeFileSync(join(fixture,'run'),`#!${run(['-p','process.execPath']).stdout.trim()}
import{readFileSync,closeSync}from'node:fs';
const frame=JSON.parse(readFileSync(5,'utf8'));closeSync(5);
const input=readFileSync(0);
console.log(JSON.stringify({schema:frame.schema,inputs:frame.credentialInputs,api:process.env.SCOUT_EXTENSION_API,
argv:process.argv.slice(2),cwd:process.cwd(),stdin:input.toString('base64'),executable:frame.cli.executable}));
`,{mode:0o700});
    const install=invoke(['--json','extensions','install','a3-context',fixture]);assert.equal(install.status,0,install.stderr);
    const coordinate=run(['-e',`import{currentExtensionChannelCoordinate as c}from ${JSON.stringify(resolve(root,'packages/runtime/src/extension-channel-qualification.ts'))};console.log(JSON.stringify(c()));`]);
    assert.equal(coordinate.status,0,coordinate.stderr);const supported=JSON.parse(coordinate.stdout)!==null;
    function refused(result,reason){assert.equal(result.status,69,result.stderr);assert.equal(result.stdout,'');assert.equal(JSON.parse(result.stderr).reason,reason);assert.ok(!result.stderr.includes(env.SCOUT_DIST_KEY));}
    const input=Buffer.from([0,255,10,128]);
    for(let i=0;i<8;i++){
      const result=invoke(['--json','a3-context','login','--key','-'],input);
      if(!supported){refused(result,'context_backend_unproven');continue;}
      assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
      assert.deepEqual(JSON.parse(result.stdout),{schema:'scout.extension-context/v1',inputs:[],api:'2',argv:['login','--key','-'],cwd:realpathSync(dir),stdin:input.toString('base64'),executable:realpathSync(entry)});
      assert.ok(!result.stdout.includes(env.SCOUT_DIST_KEY));
    }
    // No loader override can bypass the fixed asset requirement.
    const installedDist=join(unpack,'package/dist'),shim=join(installedDist,'extension-channel-native.c'),bytes=readFileSync(shim);
    writeFileSync(shim,Buffer.concat([bytes,Buffer.from('\n/* changed */')]));
    refused(invoke(['--json','a3-context']),'context_backend_unproven');writeFileSync(shim,bytes);
    const sidecar=join(installedDist,'extension-channel-host.mjs'),sidecarBytes=readFileSync(sidecar);rmSync(sidecar);
    refused(invoke(['--json','a3-context']),'context_backend_unproven');
    assert.equal(invoke(['--json','--help']).status,0,'general help must not need the native sidecar');
    writeFileSync(sidecar,sidecarBytes);
    writeDeclaration({...declaration,inputSchema:'scout.extension-inputs/v1',
      credentialInputs:[{id:'distribution-key',source:{kind:'environment',name:'SCOUT_DIST_KEY'},presence:'optional',destination:'distribution',purpose:'Fixture download'}],
      destinations:[{id:'distribution',defaultUrl:'https://downloads.example.test/',overrideProjection:'distribution.endpoint/v1'}]});
    const update=invoke(['--json','extensions','update','a3-context',fixture]);assert.equal(update.status,0,update.stderr);
    refused(invoke(['--json','a3-context']),supported?'input_backend_unproven':'context_backend_unproven');
    console.log(JSON.stringify({event:'context-cli-artifact',coordinate:JSON.parse(coordinate.stdout),mainSha256:createHash('sha256').update(readFileSync(entry)).digest('hex'),outsideCheckout:true,publicInvocations:8,credentialsRefused:true,badAssetsRefused:true}));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
