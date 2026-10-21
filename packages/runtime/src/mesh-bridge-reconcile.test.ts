import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { meshBridgeLaunchKey, meshBridgeExtensionCommand } from './mesh-bridge-extension.ts';
import { meshBridgeArgs } from './mesh-bridge-supervisor.ts';
// Exercise the actual base-daemon mesh functions without evaluating its service
// bootstrap. All process, network, filesystem, clock and owner probes are injected.
const source=readFileSync(new URL('./base-daemon.ts',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('async function spawnMeshBridge('),source.indexOf('async function fencePreviousMeshBridge(')).replaceAll('import.meta.url',JSON.stringify('file:///fixture/base-daemon.ts'));
const factory=new Function('h',new Bun.Transpiler({loader:'ts'}).transformSync(`
const {dirname,fileURLToPath,meshBridgeLaunchKey,meshBridgeExtensionCommand,meshBridgeArgs}=h;
const Date={now:()=>h.now};const process={env:{},pid:99,execPath:'/bin/bun',cwd:()=>'/fixture',get platform(){return h.platform}};
const config={supportDirectory:'/fixture/support',mode:'dev'};const brokerControlUrl='http://127.0.0.1:4800';
let shuttingDown=false,meshBridgeProcess=null,meshBridgeRunningKey=null,meshBridgeSelectionKey=null,meshBridgeObservedLaunch={};
let meshBridgeNextStartAt=0,meshBridgeRestartDelayMs=1000,meshBridgeStartedAt=0,meshBridgeUnconfiguredMtimeMs=null,meshBridgeLastIdleReason=null,meshBridgeReconcileInFlight=false;
const MESH_BRIDGE_UNCONFIGURED_RETRY_MS=300000,MESH_BRIDGE_STOP_TIMEOUT_MS=6000,MESH_BRIDGE_STABLE_AFTER_MS=60000,MESH_BRIDGE_EXIT_UNCONFIGURED=78,RESTART_MIN_DELAY_MS=1000,RESTART_MAX_DELAY_MS=30000;
const resolveMeshBridgeDesiredState=()=>h.desired,resolveMeshBridgeExtension=()=>h.selected;
const resolveOpenScoutRepoRoot=()=>null,resolveBunExecutable=()=>({path:'/bin/bun'}),resolveMeshBridgeEntrypoint=()=>'/legacy/scout.ts';
const loadOpenScoutRuntimeBuildIdentity=()=>({version:'1.0.0'}),writeMeshBridgeLaunchConfig=()=>'/fixture/support/runtime/mesh-bridge.launch.json';
const spawn=(...args)=>h.spawn(...args),logFile=()=>0,isChildExited=p=>p.exitCode!==null||p.signalCode!==null;
const readProcessIdentity=()=>({startedAt:'expected',args:'/installed/scout-mesh bridge'});
const writeMeshBridgeState=s=>h.states.push(s),warn=(...args)=>h.warnings.push(args),log=()=>{};
const terminateChildProcess=async child=>{h.order.push('stop');if(h.stop)await h.stop(child);else {child.exitCode=0;child.emit('exit',0,null);}};
const fencePreviousMeshBridge=async()=>{h.order.push('fence');if(h.fence)await h.fence();};
const inspectLaunchdJob=()=>h.job,legacyMeshBridgeLaunchdTarget=()=>'/fixture-job';
${functions}
return {tick:reconcileMeshBridgeOnce,state:()=>({nextStartAt:meshBridgeNextStartAt,backoff:meshBridgeRestartDelayMs})};
`));
function ready(digest='a'){return {state:'ready',key:digest,digest,command:'/installed/scout-mesh',extension:{name:'mesh',command:'/installed/scout-mesh',root:'/installed',version:'1.0.0'}};}
function harness(){
 const h:any={dirname,fileURLToPath,meshBridgeLaunchKey,meshBridgeExtensionCommand,meshBridgeArgs,now:100000,platform:'linux',job:'absent',desired:{run:true,configPath:'/owned/mcp-bridge.json',configDigest:'config',configMtimeMs:1000},selected:ready(),states:[],warnings:[],order:[],children:[],launches:[]};
 h.spawn=(command:any,args:any,options:any)=>{h.order.push('spawn');h.launches.push({command,args,options});const child:any=new EventEmitter();child.pid=100+h.children.length;child.exitCode=null;child.signalCode=null;h.children.push(child);return child;};
 return {h,supervisor:factory(h)};
}
test('base launches installed command directly and absence alone retains builtin fallback',async()=>{
 const {h,supervisor}=harness();await supervisor.tick();expect(h.launches[0]).toMatchObject({command:'/installed/scout-mesh',args:['bridge','--config','/fixture/support/runtime/mesh-bridge.launch.json']});expect(h.children).toHaveLength(1);
 const other=harness();other.h.selected={state:'absent',key:'absent'};await other.supervisor.tick();expect(other.h.launches[0]).toMatchObject({command:'/bin/bun',args:['/legacy/scout.ts','mesh','bridge','--config','/owned/mcp-bridge.json']});expect(other.h.states.at(-1).extensionState).toBe('absent');
});
test('digest update waits for old child exit before launching the new one',async()=>{
 const {h,supervisor}=harness();await supervisor.tick();let release!:()=>void;
 h.selected=ready('b');h.stop=async(child:any)=>{await new Promise<void>(r=>release=r);child.exitCode=0;child.emit('exit',0,null);};
 const pending=supervisor.tick();await Bun.sleep(0);expect(h.children).toHaveLength(1);release();await pending;expect(h.children).toHaveLength(2);expect(h.order).toEqual(['fence','spawn','stop','fence','spawn']);
});
test('refused selection stops child, backs off and never falls back; repair lifts refusal',async()=>{
 const {h,supervisor}=harness();await supervisor.tick();h.selected={state:'refused',key:'refused',reason:'removed'};await supervisor.tick();expect(h.children).toHaveLength(1);expect(h.states.at(-1)).toMatchObject({state:'refused',extensionState:'refused'});const warnings=h.warnings.length;
 await supervisor.tick();expect(h.warnings).toHaveLength(warnings);expect(h.children).toHaveLength(1);h.now+=2000;await supervisor.tick();expect(supervisor.state().backoff).toBe(4000);
 h.selected=ready('reinstalled');await supervisor.tick();expect(h.children).toHaveLength(2);expect(h.launches.at(-1).command).toBe('/installed/scout-mesh');
});
test('exit78 cooldown is lifted by digest or config revision, never same unchanged input',async()=>{
 const {h,supervisor}=harness();await supervisor.tick();h.children[0].exitCode=78;h.children[0].emit('exit',78,null);expect(supervisor.state().nextStartAt).toBe(h.now+300000);await supervisor.tick();expect(h.children).toHaveLength(1);
 h.selected=ready('b');await supervisor.tick();expect(h.children).toHaveLength(2);h.children[1].exitCode=78;h.children[1].emit('exit',78,null);h.desired={...h.desired,configMtimeMs:1001};await supervisor.tick();expect(h.children).toHaveLength(3);
});
test('loaded or unknown legacy job blocks spawn; only confirmed absent proceeds',async()=>{
 const {h,supervisor}=harness();h.platform='darwin';h.job='loaded';await supervisor.tick();h.job='unknown';await supervisor.tick();expect(h.children).toHaveLength(0);h.job='absent';await supervisor.tick();expect(h.children).toHaveLength(1);
});
test('failure to stop or fence old child prevents another process',async()=>{
 const {h,supervisor}=harness();await supervisor.tick();h.selected=ready('b');h.stop=async()=>{};await expect(supervisor.tick()).rejects.toThrow('has not exited');expect(h.children).toHaveLength(1);
 const fresh=harness();fresh.h.fence=async()=>{throw new Error('not fenced');};await expect(fresh.supervisor.tick()).rejects.toThrow('not fenced');expect(fresh.h.children).toHaveLength(0);
});
test('running observation refreshes timestamps without another process or entrypoint lookup',async()=>{
 const {h,supervisor}=harness();await supervisor.tick();h.now+=5000;await supervisor.tick();expect(h.children).toHaveLength(1);expect(h.states.at(-1)).toMatchObject({state:'running',artifactDigest:'a',extensionVersion:'1.0.0',extensionState:'ready',pid:100,processStartedAt:'expected'});
});
