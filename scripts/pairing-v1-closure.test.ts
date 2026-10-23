import {test,expect} from "bun:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
// git show 509c759556871be53ed4fa094fa9fd1e8a435712:<runtime source path>.
// These committed bytes are required even when CI has shallow history.
const hashes = {
  "pairing-security/trust-owner.ts": "e0f650bacb7e72a413df1beb6520e136ba237feaf376500f5de77d0e9a6c4695",
  "support-paths.ts": "89bb061034a2e8ce7d11ca17c4db888744fd980d2a2e101ad8d4d2604298c6b1",
  "instance.ts": "22872b4328ff65c863308adaad4e2035b083ed6694c0ac8d8461e1a11a047f65"
};
test("pinned v1 whole recursive closure is exact 509c7595 bytes, with no current-code shim",async()=>{
 const base=new URL("./fixtures/pairing-v1/",import.meta.url),visited=new Set<string>();
 function visit(path:string){
  if(visited.has(path))return;visited.add(path);
  expect(Object.hasOwn(hashes,path),`un-pinned import ${path}`).toBe(true);
  const bytes=readFileSync(new URL(path,base));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(hashes[path as keyof typeof hashes]);
  for(const match of bytes.toString().matchAll(/\bfrom\s*["']([^"']+)["']/g)){
   const specifier=match[1]!;
   if(!specifier.startsWith(".")){expect(specifier.startsWith("node:")).toBe(true);continue;}
   const dependency=new URL(specifier.replace(/\.js$/,".ts"),new URL(path,base));
   expect(dependency.href.startsWith(base.href)).toBe(true);
   visit(decodeURIComponent(dependency.href.slice(base.href.length)));
  }
 }
 visit("pairing-security/trust-owner.ts");
 expect([...visited].sort()).toEqual(Object.keys(hashes).sort());
 const old=await import("./fixtures/pairing-v1/pairing-security/trust-owner.ts");
 expect(typeof old.pairingTrustOwner).toBe("function");
 console.log(JSON.stringify({commit:"509c759556871be53ed4fa094fa9fd1e8a435712",hashes,recursive:[...visited]}));
});
