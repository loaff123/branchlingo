import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {analyzeCatalog,generateCases} from '../src/index.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const input=()=>({manifestBytes:fs.readFileSync(path.join(root,'examples/manifest.json')),catalogsById:new Map(['en','fr','ja'].map(id=>[id,fs.readFileSync(path.join(root,'examples/files.json'))]))});

test('replay refuses differing source bytes in an actually resolved transitive dependency',async()=>{
  const analyzed=await analyzeCatalog(input());
  assert.equal(analyzed.status,'analyzed');
  const pack=await generateCases(analyzed.analysis);
  assert.equal(pack.status,'complete');
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),'branchlingo-runtime-review-'));
  try{
    for(const entry of ['src','schemas','bin','package.json','runtime-lock.json','node_modules'])fs.cpSync(path.join(root,entry),path.join(copy,entry),{recursive:true});
    const nested=path.join(copy,'node_modules/intl-messageformat/node_modules/@formatjs/fast-memoize');
    fs.cpSync(path.join(root,'node_modules/@formatjs/fast-memoize'),nested,{recursive:true});
    fs.appendFileSync(path.join(nested,'index.js'),'\n// Distinct installed dependency source for the runtime identity regression.\n');
    const {replayCases}=await import(pathToFileURL(path.join(copy,'src/index.mjs')));
    const replay=await replayCases({...input(),packBytes:Buffer.from(JSON.stringify(pack))});
    assert.notEqual(replay.status,'verified','runtime verification must cover the transitive source actually imported by intl-messageformat');
  }finally{fs.rmSync(copy,{recursive:true,force:true});}
});

test('replay verifies the controlling package metadata rather than a decoy beside a require-only entry',async()=>{
  const analyzed=await analyzeCatalog(input());
  assert.equal(analyzed.status,'analyzed');
  const pack=await generateCases(analyzed.analysis);
  assert.equal(pack.status,'complete');
  const copy=fs.mkdtempSync(path.join(os.tmpdir(),'branchlingo-conditional-review-'));
  try{
    for(const entry of ['src','schemas','bin','package.json','runtime-lock.json','node_modules'])fs.cpSync(path.join(root,entry),path.join(copy,entry),{recursive:true});
    const source=path.join(root,'node_modules/@formatjs/fast-memoize');
    const nested=path.join(copy,'node_modules/intl-messageformat/node_modules/@formatjs/fast-memoize');
    for(const variant of ['require','import'])fs.cpSync(source,path.join(nested,variant),{recursive:true});
    const metadata=JSON.parse(fs.readFileSync(path.join(source,'package.json')));
    metadata.exports={'.':{import:'./import/index.js',require:'./require/index.js'}};
    fs.writeFileSync(path.join(nested,'package.json'),JSON.stringify(metadata));
    fs.appendFileSync(path.join(nested,'import/index.js'),'\n// ESM source differs while the require-only decoy remains pinned.\n');
    const {replayCases}=await import(pathToFileURL(path.join(copy,'src/index.mjs')));
    const replay=await replayCases({...input(),packBytes:Buffer.from(JSON.stringify(pack))});
    assert.notEqual(replay.status,'verified','checking require resolution must not miss conditional ESM source selected by the real formatter');
  }finally{fs.rmSync(copy,{recursive:true,force:true});}
});
