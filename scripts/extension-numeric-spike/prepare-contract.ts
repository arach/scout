/** Isolated seam-only import-edge injection. NEVER a transport positive.
 * Builtin mocks do not reliably replace createRequire('bun:ffi') on both Buns.
 * Transpile the actual adapter with only its TWO import edges substituted;
 * the seam/loadNative/factory bodies are unchanged. Real proofs import source.
 */
import {readFileSync,readdirSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {pathToFileURL} from "node:url";
export async function prepareContract() {
let compiles=0,pairs=0;
const library={symbols:{scout_channel_pair:()=>{pairs++;throw Error("seam created pair");}}};
const key=Symbol.for("scout.prepare-contract.ffi");
const globals=globalThis as typeof globalThis & {[key]?:unknown};
globals[key]={cc:()=>{compiles++;return library;},ptr:()=>{throw Error("seam created endpoint");}};
const source=readFileSync(new URL("../../packages/runtime/src/extension-channel-io.ts",import.meta.url),"utf8");
const edge='import { createRequire } from "node:module";';
if(source.split(edge).length!==2||!source.includes('from "./inherited-descriptors.js"'))throw Error("adapter import contract changed");
const unitSource=source.replace(edge,`const createRequire=()=>()=>globalThis[Symbol.for("scout.prepare-contract.ffi")];`)
 .replace('from "./inherited-descriptors.js"',`from ${JSON.stringify(new URL("../../packages/runtime/src/inherited-descriptors.ts",import.meta.url).href)}`);
const temporary=mkdtempSync(join(tmpdir(),"scout-prepare-contract-"));
const fixture=join(temporary,"adapter-unit.ts");writeFileSync(fixture,unitSource);
try {
const adapter=await import(pathToFileURL(fixture).href);
if(adapter.prepareExtensionChannelCodeForWitness()!==undefined||adapter.prepareExtensionChannelCodeForWitness()!==undefined)throw Error("seam returned a capability");
if(compiles!==1||pairs!==0)throw Error("seam is not compile-only/idempotent");
let released=false;
adapter.releaseExtensionChannelCodeForWitness((value:object)=>{if(value!==library)throw Error("wrong code ownership");released=true;});
if(!released)throw Error("zero-endpoint release failed");
if(!source.includes("export function prepareExtensionChannelCodeForWitness(): void { native ??= loadNative(); }"))throw Error("seam call graph changed");
const facade=readFileSync(new URL("../../packages/runtime/src/extension-channel-host.ts",import.meta.url),"utf8");
if(facade.includes("prepareExtensionChannelCodeForWitness"))throw Error("facade reaches seam");
let productionCallers=0;
const walk=(directory:string)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){
 const path=join(directory,entry.name);
 if(entry.isDirectory())walk(path);
 else if(entry.isFile()&&/\.[cm]?tsx?$/.test(entry.name)&&!/[._](test|spec)\./.test(entry.name)) {
  if(readFileSync(path,"utf8").includes("prepareExtensionChannelCodeForWitness"))productionCallers++;
 }
}};
walk(new URL("../../packages/cli/src",import.meta.url).pathname);
if(productionCallers)throw Error("CLI/environment reaches witness seam");
console.log(JSON.stringify({event:"prepare-contract",compiles,pairs,endpoints:0,idempotent:true,productionCallers}));

} finally {delete globals[key];rmSync(temporary,{recursive:true,force:true});}

}
if (import.meta.main) await prepareContract();
