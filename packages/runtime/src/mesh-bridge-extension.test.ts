import { test, expect, beforeEach, afterEach } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { resolveMeshBridgeExtension, meshBridgeLaunchKey, writeMeshBridgeLaunchConfig, meshBridgeExtensionCommand, readMeshBridgeConfigSnapshot, readMeshBridgeDestinationKeyId } from './mesh-bridge-extension.ts';
import { resolveMeshBridgeDesiredState, meshBridgeConfigPath, meshBridgeStatePath, fenceRecordedMeshBridge } from './mesh-bridge-supervisor.ts';
import { isMeshBridgeCommand } from './scout-bridge-command.ts';
import { MeshBridgeManagement } from './mesh-bridge-management.ts';
let root:string,support:string,env:NodeJS.ProcessEnv;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'mesh-extension-supervisor-'));support=join(root,'support');mkdirSync(support,{mode:0o700});env={HOME:root,SCOUT_HOME:join(root,'home'),PATH:process.env.PATH};});
afterEach(()=>rmSync(root,{force:true,recursive:true}));
function artifact(base=join(root,'home/extensions/mesh')){mkdirSync(join(base,'bin'),{recursive:true,mode:0o700});writeFileSync(join(base,'extension.json'),JSON.stringify({api:1,command:'bin/scout-mesh',version:'1.0.0'}));writeFileSync(join(base,'bin/scout-mesh'),'#!/bin/sh\nexit 0\n',{mode:0o700});return base;}
function config(value:unknown={relayUrl:'https://relay.example.invalid',token:'fixture-secret'}){const path=meshBridgeConfigPath(support);writeFileSync(path,JSON.stringify(value),{mode:0o600});return path;}
function desired(){const result=resolveMeshBridgeDesiredState({supportDirectory:support,env,home:root});if(!result.run)throw new Error(result.reason);return result;}
test('absent is distinct from refused, including removed marker, with no older fallback',()=>{
  expect(resolveMeshBridgeExtension(env).state).toBe('absent');const base=artifact();expect(resolveMeshBridgeExtension(env).state).toBe('ready');chmodSync(join(base,'bin/scout-mesh'),0o600);expect(resolveMeshBridgeExtension(env)).toMatchObject({state:'refused',reason:'untrusted-or-invalid'});
  writeFileSync(join(base,'extension.json'),JSON.stringify({disabled:true}));expect(resolveMeshBridgeExtension(env)).toMatchObject({state:'refused',reason:'removed'});
  // Explicit primary override is the only root in this isolated fixture.
  artifact(join(root,'.openscout/extensions/mesh'));expect(resolveMeshBridgeExtension(env).state).toBe('refused');
});
test('artifact bytes and config contents change reconciliation identity without mtime change',()=>{
  config();const base=artifact(),a=desired(),first=resolveMeshBridgeExtension(env),key=meshBridgeLaunchKey(a,first);
  writeFileSync(join(base,'bin/scout-mesh'),'#!/bin/sh\nexit 1\n');const second=resolveMeshBridgeExtension(env);expect(meshBridgeLaunchKey(a,second)).not.toBe(key);
  const path=meshBridgeConfigPath(support),time=statSync(path).mtime;writeFileSync(path,JSON.stringify({relayUrl:'https://other.example.invalid'}));utimesSync(path,time,time);const b=desired();expect(b.configDigest).not.toBe(a.configDigest);expect(meshBridgeLaunchKey(b,second)).not.toBe(meshBridgeLaunchKey(a,second));
  expect(meshBridgeLaunchKey({...b,configMtimeMs:b.configMtimeMs+1},second)).not.toBe(meshBridgeLaunchKey(b,second));
});
test('launch descriptor projects fixed paths and credential refs, never node keys or ambient secrets',async()=>{
  const path=config();const d=desired();const keyFile=join(root,'admin-key');writeFileSync(keyFile,'a'.repeat(64),{mode:0o600});
  const target=writeMeshBridgeLaunchConfig({supportDirectory:support,configPath:path,configDigest:d.configDigest,brokerUrl:'http://127.0.0.1:4800',parentPid:process.pid,eventsEnabled:true,localAdmin:{keyFile,destinationKeyId:'b'.repeat(64)}});
  expect(statSync(target).mode&0o777).toBe(0o600);const raw=JSON.parse(readFileSync(target,'utf8'));expect(raw).toMatchObject({dir:support,supervisor:{parentPid:process.pid},eventsEnabled:true,localAdmin:{keyFile,destinationKeyId:'b'.repeat(64)}});expect(raw).not.toHaveProperty('nodePrivateKey');expect(raw).not.toHaveProperty('tokenFile');
  // Contract parity is tested against the actual detached client's parser.
  const {loadLaunchConfig}=await import('../../mesh-extension/src/bridge-config.ts');expect(loadLaunchConfig(target).currentDirectory).toBe(support);
  const selected=resolveMeshBridgeExtension({...env,OPENSCOUT_EXTENSIONS_HOME:artifact().replace(/\/mesh$/,'')});if(selected.state!=='ready')throw new Error(selected.state);
  const launch=meshBridgeExtensionCommand({selected,configPath:target,env:{...env,OPENSCOUT_LOCAL_ADMIN_KEY_FILE:'must-not-pass',OPENSCOUT_MCP_TOKEN:'must-not-pass',OPENSCOUT_PARENT_PID:'123'},brokerUrl:'http://127.0.0.1:4800',cliVersion:'1.0.0'});
  expect(launch.command).toBe(selected.command);expect(launch.args).toEqual(['bridge','--config',target]);for(const name of ['OPENSCOUT_LOCAL_ADMIN_KEY_FILE','OPENSCOUT_MCP_TOKEN','OPENSCOUT_PARENT_PID'])expect(launch.env[name]).toBeUndefined();
});
test('descriptor never follows caller token/cwd paths and snapshots refuse links or oversized files',()=>{
  const path=config({relayUrl:'https://relay.example.invalid',tokenFile:'/caller/token'});const input={supportDirectory:support,configPath:path,configDigest:desired().configDigest,brokerUrl:'http://127.0.0.1:4800',parentPid:process.pid,eventsEnabled:false};expect(()=>writeMeshBridgeLaunchConfig(input)).toThrow();
  config({relayUrl:'https://relay.example.invalid',dir:'/caller/cwd'});expect(()=>writeMeshBridgeLaunchConfig({...input,configDigest:desired().configDigest})).toThrow();
  writeFileSync(path,'x'.repeat(65537));expect(()=>readMeshBridgeConfigSnapshot(path)).toThrow();rmSync(path);const other=join(root,'other');writeFileSync(other,'{}');symlinkSync(other,path);expect(()=>readMeshBridgeConfigSnapshot(path)).toThrow();
});
test('config rewrite during launch refuses stale snapshot and preserves prior descriptor',()=>{
  const path=config(),d=desired();const input={supportDirectory:support,configPath:path,configDigest:d.configDigest,brokerUrl:'http://127.0.0.1:4800',parentPid:process.pid,eventsEnabled:false};const target=writeMeshBridgeLaunchConfig(input),old=readFileSync(target,'utf8');config({relayUrl:'https://changed.example.invalid'});expect(()=>writeMeshBridgeLaunchConfig(input)).toThrow();expect(readFileSync(target,'utf8')).toBe(old);
});
test('observed refused selection remains distinct and redacted',()=>{
  config();mkdirSync(dirname(meshBridgeStatePath(support)),{recursive:true});writeFileSync(meshBridgeStatePath(support),JSON.stringify({state:'refused',extensionState:'refused',pid:null,updatedAt:1000,artifactDigest:'not-a-digest',extensionVersion:'secret-version',token:'never-echo'}));
  const manager=new MeshBridgeManagement({supportDirectory:support,lifecycle:async()=>{},now:()=>1500});const view=manager.read();expect(view.observed).toMatchObject({state:'refused',extensionState:'refused',stale:false,artifactDigest:null,extensionVersion:null});expect(JSON.stringify(view)).not.toContain('never-echo');
});
test('installed executable command classifier is anchored for direct and Bun launches',()=>{
  for(const s of ['/opt/scout/extensions/mesh/bin/scout-mesh bridge --config /owned/cfg','/opt/Application Support/mesh/bin/scout-mesh bridge','bun /opt/Application Support/mesh/bin/scout-mesh bridge','/opt/bun --smol /opt/mesh/bin/scout-mesh bridge','scout-mesh bridge'])expect(isMeshBridgeCommand(s)).toBe(true);
  for(const s of ['sh -c /opt/scout-mesh bridge','/bin/sh -c /opt/scout-mesh bridge','claude --prompt /opt/scout-mesh bridge','/bin/echo /opt/scout-mesh bridge','bun innocent.ts /opt/scout-mesh bridge','bun -e /opt/scout-mesh bridge','node --eval=x /opt/scout-mesh bridge','/opt/not-scout-mesh bridge','/opt/scout-mesh bridges'])expect(isMeshBridgeCommand(s)).toBe(false);
});
test('public admin destination read is bounded and never accepts a malformed identity',async()=>{
  expect(await readMeshBridgeDestinationKeyId('http://127.0.0.1:1',(async()=>Response.json({card:{keyId:'a'.repeat(64)}})) as any)).toBe('a'.repeat(64));
  await expect(readMeshBridgeDestinationKeyId('http://127.0.0.1:1',(async()=>new Response('x'.repeat(65537))) as any)).rejects.toThrow();
  await expect(readMeshBridgeDestinationKeyId('http://127.0.0.1:1',(async()=>Response.json({card:{keyId:'invalid'}})) as any)).rejects.toThrow();
});
function record(){mkdirSync(dirname(meshBridgeStatePath(support)),{recursive:true});writeFileSync(meshBridgeStatePath(support),JSON.stringify({pid:4242,processStartedAt:'expected'}));}
test('fence never signals a reused PID after the old bridge exits',async()=>{
  record();let now=0,current:any={args:'/opt/scout-mesh bridge',startedAt:'expected'};const signals:string[]=[];
  await fenceRecordedMeshBridge(support,{readIdentity:()=>current,signal:(_pid,signal)=>{signals.push(signal);},now:()=>now,sleep:async ms=>{now+=ms;current={args:'/bin/unrelated',startedAt:'new'};},timeoutMs:100});expect(signals).toEqual(['SIGTERM']);
});
test('fence confirms SIGKILL exit or refuses to launch a second process',async()=>{
  record();let now=0,alive=true;const identity={args:'/opt/scout-mesh bridge',startedAt:'expected'},signals:string[]=[];
  await fenceRecordedMeshBridge(support,{readIdentity:()=>alive?identity:null,signal:(_pid,signal)=>{signals.push(signal);if(signal==='SIGKILL')alive=false;},now:()=>now,sleep:async ms=>{now+=ms;},timeoutMs:100});expect(signals).toEqual(['SIGTERM','SIGKILL']);
  now=0;await expect(fenceRecordedMeshBridge(support,{readIdentity:()=>identity,signal:()=>{},now:()=>now,sleep:async ms=>{now+=ms;},timeoutMs:100})).rejects.toThrow('has not exited');
});
test('built artifact installs and the supervisor plan executes that command directly',async()=>{
  const artifactPath=join(root,'artifact');const build=Bun.spawn([process.execPath,'run',resolve(import.meta.dir,'../../mesh-extension/scripts/build.ts'),artifactPath],{stdout:'ignore',stderr:'pipe'});expect(await build.exited).toBe(0);
  const {mutateScoutExtension}=await import('../../../apps/desktop/src/cli/extension-install.ts');await mutateScoutExtension('install','mesh',artifactPath,env);
  const selected=resolveMeshBridgeExtension(env);if(selected.state!=='ready')throw new Error(JSON.stringify(selected));
  const path=config(),launchPath=writeMeshBridgeLaunchConfig({supportDirectory:support,configPath:path,configDigest:desired().configDigest,brokerUrl:'http://127.0.0.1:1',parentPid:process.pid,eventsEnabled:false});
  const plan=meshBridgeExtensionCommand({selected,configPath:launchPath,env,brokerUrl:'http://127.0.0.1:1',cliVersion:'1.0.0'});
  const child=Bun.spawn([plan.command,'--help'],{env:plan.env,cwd:root,stdout:'pipe',stderr:'pipe'});expect(await child.exited).toBe(0);expect(await new Response(child.stdout).text()).toContain('HTTP runtime client');expect(plan.args[0]).toBe('bridge');
});
