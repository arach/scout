import {test,expect} from "bun:test";
import {mkdtempSync,existsSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {writeProjectConfig} from "./setup.ts";
const config={version:1,agent:{id:"fixture"}} as Parameters<typeof writeProjectConfig>[1];
async function isolated(body:(root:string)=>Promise<void>){const root=mkdtempSync(join(tmpdir(),"scout-setup-admission-"));try{await body(root);}finally{rmSync(root,{recursive:true,force:true});}}
test("setup effect: trusted caller without a hook retains project and ignore writes",()=>isolated(async root=>{
 await writeProjectConfig(root,config);expect(JSON.parse(readFileSync(join(root,".openscout/project.json"),"utf8"))).toEqual(config);expect(readFileSync(join(root,".gitignore"),"utf8")).toContain(".openscout/project.json");
}));
test("setup effect: admission follows serialization before directory submission",()=>isolated(async root=>{
 let revoked=false;const refusal=new Error("revoked");const subject={toJSON(){revoked=true;return config;}} as unknown as typeof config;
 await expect(writeProjectConfig(root,subject,()=>{if(revoked)throw refusal;})).rejects.toBe(refusal);
 expect(existsSync(join(root,".openscout"))).toBe(false);
}));
test("setup effect: file submission re-admits after asynchronous directory creation",()=>isolated(async root=>{
 let calls=0;const refusal=new Error("revoked");
 await expect(writeProjectConfig(root,config,()=>{if(++calls===2)throw refusal;})).rejects.toBe(refusal);
 expect(calls).toBe(2);expect(existsSync(join(root,".openscout"))).toBe(true);expect(existsSync(join(root,".openscout/project.json"))).toBe(false);
}));
test("setup effect: ignore submission re-admits after its asynchronous read",()=>isolated(async root=>{
 let calls=0;const refusal=new Error("revoked");
 await expect(writeProjectConfig(root,config,()=>{if(++calls===3)throw refusal;})).rejects.toBe(refusal);
 expect(existsSync(join(root,".openscout/project.json"))).toBe(true);expect(existsSync(join(root,".gitignore"))).toBe(false);
}));
test("setup effect: asynchronous admission cannot authorize configuration",()=>isolated(async root=>{
 await expect(writeProjectConfig(root,config,async()=>{})).rejects.toThrow("synchronous effect admission required");expect(existsSync(join(root,".openscout"))).toBe(false);
}));
