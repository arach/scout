import { constants, closeSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { MeshEnrollmentHandshake } from './trust-service.ts';
/** Client-owned initiator state, never the runtime's support directory. */
function path(directory?: string) {
  const home = process.env.SCOUT_HOME ?? process.env.OPENSCOUT_HOME ?? join(homedir(),'.scout');
  return join(directory ?? join(resolve(home),'extension-state','mesh'),'enroll-pending.json');
}
export function savePendingMeshEnrollment(value: MeshEnrollmentHandshake, directory?: string) {
  const target=path(directory);mkdirSync(dirname(target),{recursive:true,mode:0o700});
  const tmp=`${target}.${randomUUID()}.tmp`;
  try {writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});renameSync(tmp,target);} finally {rmSync(tmp,{force:true});}
}
export function loadPendingMeshEnrollment(directory?: string): MeshEnrollmentHandshake | null {
  let fd: number | undefined;
  try {fd=openSync(path(directory),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);if(!stat.isFile() || stat.size>64*1024 || (stat.mode&0o077) || process.getuid && stat.uid!==process.getuid())throw new Error('invalid client enrollment state');
    const value=JSON.parse(readFileSync(fd,'utf8'));if(value.version!==1 || !value.enrollmentId || !Array.isArray(value.words))throw new Error('invalid client enrollment state');return value;
  } catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new Error('client enrollment state is invalid; start enrollment again');}
  finally {if(fd!==undefined)closeSync(fd);}
}
export function clearPendingMeshEnrollment(directory?: string) {rmSync(path(directory),{force:true});}
