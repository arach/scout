import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import manifest from '../package.json';
// Build a prebuilt artifact for `scout extensions install mesh <directory>`.
const output=resolve(process.argv[2]??'dist/mesh');mkdirSync(join(output,'bin'),{recursive:true});
const result=await Bun.build({entrypoints:[resolve(import.meta.dir,'../src/main.ts')],target:'bun',format:'esm',outdir:join(output,'bin'),naming:'scout-mesh',minify:false});
if(!result.success)throw new AggregateError(result.logs,'mesh artifact build failed');
chmodSync(join(output,'bin/scout-mesh'),0o755);
writeFileSync(join(output,'extension.json'),JSON.stringify({api:1,name:'mesh',version:manifest.version,summary:'Mesh coordination through the runtime HTTP API',command:'bin/scout-mesh'},null,2)+'\n',{mode:0o644});
console.log(output);
