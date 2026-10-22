import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Source/output pairs come from JS bundler metafiles + the browser build graph;
// never regenerate the reviewed inventory as part of validation.
export function checkCliPrivateInventory(expected, observed, packedEntries, readPackedEntry) {
 const failures=[];
 const pairs=rows=>new Set(rows.flatMap(row=>row.packagedDestinations.map(dest=>row.source+'\0'+dest)));
 const wanted=pairs(expected.sources),seen=pairs(observed.sources);
 const sourceOnly=new Set(observed.sourceOnly??[]);
 for(const p of expected.sourceOnly??[])if(!sourceOnly.has(p))failures.push('Stale source-only private input: '+p);
 for(const p of sourceOnly)if(!(expected.sourceOnly??[]).includes(p))failures.push('Unlisted source-only private input: '+p);
 for(const item of seen)if(!wanted.has(item))failures.push('Unlisted private input/output: '+item.replace('\0',' -> '));
 for(const item of wanted)if(!seen.has(item))failures.push('Stale private input/output: '+item.replace('\0',' -> '));
 const actual=new Set(packedEntries), privateOutputs=new Set(observed.privateOutputs);
 for(const p of privateOutputs)if(!expected.privateOutputs.includes(p))failures.push('Unlisted private packed file: '+p);
 for(const p of expected.privateOutputs){if(!privateOutputs.has(p))failures.push('Stale private packed exception: '+p);if(!actual.has(p))failures.push('Missing private packed file: '+p);}
 // The manifest is closed for all emitted files, including hashed client assets.
 // A newly packed file must be classified/reviewed, never accepted via prefix.
 for(const p of actual)if(!expected.packedFiles.includes(p))failures.push('Unlisted packed file: '+p);
 for(const p of expected.packedFiles)if(!actual.has(p))failures.push('Stale packed file: '+p);
 for(const p of expected.removedSources??[])if(observed.sources.some(r=>r.source===p))failures.push('Removed private source returned: '+p);
 for(const p of expected.removedOutputs??[])if(actual.has(p))failures.push('Removed private output returned: '+p);
 if(readPackedEntry)for(const p of actual){
  const digest=observed.outputSha256?.[p];
  if(!digest)failures.push('Missing observed output digest: '+p);
  else if(createHash('sha256').update(readPackedEntry(p)).digest('hex')!==digest)failures.push('Packed output differs from observed build bytes: '+p);
 }
 return failures;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [inventory,observed,entries]=process.argv.slice(2);
 if(!entries)throw Error('Usage: bun scripts/check-cli-private-inventory.mjs reviewed.json observed.json packed-entries.json');
 const errors=checkCliPrivateInventory(JSON.parse(fs.readFileSync(inventory)),JSON.parse(fs.readFileSync(observed)),JSON.parse(fs.readFileSync(entries)));
 if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Named private inventory matches; no stale/unlisted files.');
}
