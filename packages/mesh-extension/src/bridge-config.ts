import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { RuntimeHttpClient } from './http-client.ts';
import { localAdminProof } from './local-admin-proof.ts';
import { selectCoreTools } from './core-http-mcp.ts';

const path = z.string().min(1).max(4096);
export const launchConfigSchema = z.object({
  enabled: z.boolean().optional(), relayUrl: z.string().url().optional(), brokerUrl: z.string().url(),
  token: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/).optional(), tokenFile: path.optional(),
  tokenKeychainService: z.string().regex(/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/).optional(),
  sender: z.string().min(1).max(128).optional(), node: z.string().max(128).optional(), dir: path.optional(),
  tools: z.union([z.literal('core'),z.array(z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/)).max(128)]).optional(),
  remoteDiagnostics: z.array(z.unknown()).max(128).optional(),
  localAdmin: z.object({ keyFile: path, destinationKeyId: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  supervisor: z.object({ parentPid: z.number().int().min(2) }).strict().optional(),
  eventsEnabled: z.boolean().optional(),
}).strict();
/** Read only explicit user-owned regular files, including the configuration. */
export function readSecretFile(path: string, maxBytes = 8192): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const s = fstatSync(fd);
    if (!s.isFile() || s.size > maxBytes || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid())) throw new Error();
    const value = readFileSync(fd,'utf8');
    if (Buffer.byteLength(value) > maxBytes) throw new Error();
    return value;
  } catch { throw new Error('explicit configuration or credential file is missing, unsafe or too large'); }
  finally { if (fd !== undefined) closeSync(fd); }
}
export function loadLaunchConfig(file: string) {
  const config = launchConfigSchema.parse(JSON.parse(readSecretFile(file,64*1024)));
  const base = dirname(resolve(file));
  const filePath = (p: string) => resolve(base,p);
  const client = new RuntimeHttpClient({ brokerUrl: config.brokerUrl,
    proof: config.localAdmin ? localAdminProof(readSecretFile(filePath(config.localAdmin.keyFile)).trim(),config.localAdmin.destinationKeyId) : undefined });
  return { config, client, filePath, currentDirectory: config.dir ? filePath(config.dir) : base };
}
export async function bridgeLaunch(file: string, overrideTools?: 'core' | string[]) {
  const loaded = loadLaunchConfig(file), {config} = loaded;
  if (config.enabled === false || !config.relayUrl) throw new Error('bridge is disabled or has no relay URL');
  const relay = new URL(config.relayUrl);
  if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash || relay.pathname !== '/') throw new Error('bridge relay must be an HTTPS origin');
  if (Array.isArray(overrideTools) && overrideTools.some(name=>!/^[a-zA-Z0-9_.-]{1,128}$/.test(name))) throw new Error('invalid bridge tool selection');
  const toolNames = selectCoreTools(overrideTools ?? config.tools).map(t=>t.name);
  let token = config.token;
  if (!token && config.tokenFile) token = readSecretFile(loaded.filePath(config.tokenFile)).trim();
  if (!token && config.tokenKeychainService && process.platform === 'darwin') {
    try {
      const result = await promisify(execFile)('/usr/bin/security',['find-generic-password','-s',config.tokenKeychainService,'-w'],{timeout:5000,maxBuffer:8192,encoding:'utf8'});
      token = result.stdout.trim();
    } catch { throw new Error('configured bridge credential is unavailable'); }
  }
  if (!token || !/^[\x21-\x7e]{1,8192}$/.test(token)) throw new Error('configured bridge credential is missing or invalid');
  if (config.supervisor && config.supervisor.parentPid !== process.ppid) throw new Error('bridge parent identity no longer matches');
  return {...loaded, token, toolNames, relayUrl:relay.origin};
}
