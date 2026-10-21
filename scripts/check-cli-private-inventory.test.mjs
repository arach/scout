import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {checkCliPrivateInventory as check} from './check-cli-private-inventory.mjs';
const source={source:'packages/web/server/index.ts',packagedDestinations:['package/dist/scout-control-plane-web.mjs']};
const expected={sources:[source],privateOutputs:['package/dist/scout-control-plane-web.mjs'],packedFiles:['package/dist/main.mjs','package/dist/scout-control-plane-web.mjs']};
const observed={sources:[source],privateOutputs:expected.privateOutputs};
test('exact inventory accepts the intermediate private graph',()=>assert.deepEqual(check(expected,observed,expected.packedFiles),[]));
test('new private source in an already-listed bundle is refused',()=>assert.match(check(expected,{...observed,sources:[source,{...source,source:'packages/web/server/unreviewed.ts'}]},expected.packedFiles).join('\n'),/Unlisted private input/));
test('stale source exception is refused',()=>assert.match(check(expected,{...observed,sources:[]},expected.packedFiles).join('\n'),/Stale private input/));
test('new hashed asset has no directory-wide exception',()=>assert.match(check(expected,observed,[...expected.packedFiles,'package/dist/client/new.js']).join('\n'),/Unlisted packed file/));
test('stale/missing packed file is refused',()=>assert.match(check(expected,observed,['package/dist/main.mjs']).join('\n'),/Missing private packed file/));
test('removed private artifact cannot return',()=>assert.match(check({...expected,removedOutputs:['package/dist/scout-control-plane-web.mjs']},observed,expected.packedFiles).join('\n'),/Removed private output/));

const bytes=Buffer.from('reviewed bundle');
const attested={...observed,outputSha256:Object.fromEntries(expected.packedFiles.map(p=>[p,createHash('sha256').update(bytes).digest('hex')]))};
test('packed bytes match the independently observed build',()=>assert.deepEqual(check(expected,attested,expected.packedFiles,()=>bytes),[]));
test('same filenames cannot hide substituted bundle bytes',()=>assert.match(check(expected,attested,expected.packedFiles,()=>Buffer.from('substituted')).join('\n'),/differs from observed build bytes/));
