import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

/** Bounded snapshot used for both reconciliation identity and the launch descriptor. */
export function readMeshBridgeConfigSnapshot(path:string): { value: Record<string,unknown>; digest:string; mtimeMs:number } {
  let fd:number|undefined;
  try {
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size>64*1024||(stat.mode&0o022)||(process.getuid&&stat.uid!==process.getuid()))throw new Error();
    const text=readFileSync(fd,'utf8');if(Buffer.byteLength(text)>64*1024)throw new Error();
    const value:unknown=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
    return {value:value as Record<string,unknown>,digest:createHash('sha256').update(text).digest('hex'),mtimeMs:stat.mtimeMs};
  }catch{throw new Error('invalid bridge configuration');}finally{if(fd!==undefined)closeSync(fd);}
}
export function meshBridgeLaunchKey(config:{configDigest:string;configMtimeMs:number},extension:MeshBridgeExtension):string {
  return `${config.configDigest}:${config.configMtimeMs}:${extension.key}`;
}
export const meshBridgeLaunchConfigPath=(supportDirectory:string)=>join(supportDirectory,'runtime','mesh-bridge.launch.json');
/** Caller is scout-base, the only spawner. No caller-controlled token/log/cwd paths. */
export function writeMeshBridgeLaunchConfig(input:{supportDirectory:string;configPath:string;configDigest:string;brokerUrl:string;parentPid:number;eventsEnabled:boolean;localAdmin?:{keyFile:string;destinationKeyId:string}}):string {
  const {value:raw,digest}=readMeshBridgeConfigSnapshot(input.configPath);
  if(digest!==input.configDigest)throw new Error('bridge configuration changed during launch');
  const relay=new URL(String(raw.relayUrl));
  if(relay.protocol!=='https:'||relay.pathname!=='/'||relay.username||relay.password||relay.search||relay.hash||raw.dir)throw new Error('invalid bridge launch configuration');
  const fixedToken=join(input.supportDirectory,'mcp-bridge.token');
  if(raw.tokenFile && raw.tokenFile!==fixedToken)throw new Error('invalid bridge token location');
  if(raw.token!==undefined && (typeof raw.token!=='string'||!/^[\x21-\x7e]{1,8192}$/.test(raw.token)))throw new Error('invalid bridge credential');
  if(raw.tokenKeychainService!==undefined && (typeof raw.tokenKeychainService!=='string'||!/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/.test(raw.tokenKeychainService)))throw new Error('invalid bridge credential reference');
  const token=typeof raw.token==='string'?raw.token:undefined;
  const value={brokerUrl:input.brokerUrl,relayUrl:relay.origin,enabled:raw.enabled!==false,tools:raw.tools??'core',
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
