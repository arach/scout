import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readMeshBridgeConfigSnapshot, validateMeshBridgeConfig } from './mesh-bridge-config.js';
export { readMeshBridgeConfigSnapshot } from './mesh-bridge-config.js';
import { findScoutExtension, scoutExtensionDigest, scoutExtensionEnv, type ScoutExtension } from './scout-extensions.js';

/** Refused/removed primary installs block all older installs and legacy fallback. */
export type MeshBridgeExtension =
  | { state: 'absent'; key: 'absent' }
  | { state: 'refused'; key: 'refused'; reason: 'removed'|'untrusted-or-invalid' }
  | { state: 'ready'; key: string; digest: string; extension: ScoutExtension; command: string };
export function resolveMeshBridgeExtension(env: NodeJS.ProcessEnv): MeshBridgeExtension {
  const extension=findScoutExtension('mesh',env);
  if(!extension)return {state:'absent',key:'absent'};
  if(extension.refused)return {state:'refused',key:'refused',reason:extension.removed?'removed':'untrusted-or-invalid'};
  try {
    const command=realpathSync(extension.command), digest=scoutExtensionDigest(extension);
    return {state:'ready',key:digest,digest,extension,command};
  } catch { return {state:'refused',key:'refused',reason:'untrusted-or-invalid'}; }
}

export function meshBridgeLaunchKey(config:{configDigest:string;configMtimeMs:number},extension:MeshBridgeExtension):string {
  return `${config.configDigest}:${config.configMtimeMs}:${extension.key}`;
}
export const meshBridgeLaunchConfigPath=(supportDirectory:string)=>join(supportDirectory,'runtime','mesh-bridge.launch.json');
/** Caller is scout-base, the only spawner. No caller-controlled token/log/cwd paths. */
export function writeMeshBridgeLaunchConfig(input:{supportDirectory:string;configPath:string;configDigest:string;brokerUrl:string;parentPid:number;eventsEnabled:boolean;localAdmin?:{keyFile:string;destinationKeyId:string}}):string {
  const {value:raw,digest}=readMeshBridgeConfigSnapshot(input.configPath);
  if(digest!==input.configDigest)throw new Error('bridge configuration changed during launch');
  const validated=validateMeshBridgeConfig(raw,input.supportDirectory);
  const fixedToken=validated.tokenFile,token=validated.token;
  const value={brokerUrl:input.brokerUrl,relayUrl:validated.relayOrigin,enabled:raw.enabled!==false,tools:raw.tools??'core',
    ...(token?{token}:raw.tokenKeychainService?{tokenKeychainService:raw.tokenKeychainService}:existsSync(fixedToken)?{tokenFile:fixedToken}:{}),
    ...(typeof raw.sender==='string'?{sender:raw.sender}:{}),dir:input.supportDirectory,
    supervisor:{parentPid:input.parentPid},eventsEnabled:input.eventsEnabled,
    ...(input.localAdmin?{localAdmin:{keyFile:resolve(input.localAdmin.keyFile),destinationKeyId:input.localAdmin.destinationKeyId}}:{})};
  const target=meshBridgeLaunchConfigPath(input.supportDirectory),tmp=`${target}.${randomUUID()}.tmp`;
  mkdirSync(dirname(target),{recursive:true,mode:0o700});
  const serialized=JSON.stringify(value)+'\n';
  if(Buffer.byteLength(serialized)>64*1024)throw new Error('bridge launch configuration exceeds bound');
  try{writeFileSync(tmp,serialized,{mode:0o600,flag:'wx'});renameSync(tmp,target);}finally{try{unlinkSync(tmp);}catch{}}
  return target;
}
/** Environment contains no ambient Scout credentials; paths are in the launch file. */
export function meshBridgeExtensionCommand(input:{selected:Extract<MeshBridgeExtension,{state:'ready'}>;configPath:string;env:NodeJS.ProcessEnv;brokerUrl:string;cliVersion:string;runtimeDir?:string}) {
  return {command:input.selected.command,args:['bridge','--config',input.configPath],
    env:scoutExtensionEnv({env:input.env,extension:input.selected.extension,brokerUrl:input.brokerUrl,cliVersion:input.cliVersion,outputMode:'plain',runtimeDir:input.runtimeDir})};
}

/** Bounded public identity read for explicit user-admin proof, not key discovery. */
export async function readMeshBridgeDestinationKeyId(brokerUrl:string, fetchImpl:typeof fetch=fetch):Promise<string> {
  const response=await fetchImpl(new URL('/v1/node',brokerUrl),{redirect:'error',signal:AbortSignal.timeout(2000)});
  if(!response.ok||!response.body)throw new Error('public runtime identity unavailable');
  const reader=response.body.getReader();let bytes=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>64*1024)throw new Error('public runtime identity exceeds bound');chunks.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});}
  const keyId=JSON.parse(Buffer.concat(chunks).toString('utf8')).card?.keyId;
  if(typeof keyId!=='string'||!/^[a-f0-9]{64}$/.test(keyId))throw new Error('public runtime identity unavailable');
  return keyId;
}
