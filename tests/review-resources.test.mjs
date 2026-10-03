import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {strictJSON,sha256,canonical} from '../src/codec.mjs';
import {HARD,PROFILE,safeRelativePath} from '../src/input.mjs';
import {analyzeCatalog,generateCases,replayCases} from '../src/index.mjs';
import {buildAnalysis} from '../src/analyze.mjs';
import {readRegular,installOutput} from '../src/files.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
function single(text='{n,plural,one{one}other{other}}',max=64,limits){
  const cat=Buffer.from(JSON.stringify({kind:'branchlingo-catalog',schemaVersion:1,messages:[{id:'m',text}]}));
  const manifest={kind:'branchlingo-manifest',schemaVersion:1,profile:PROFILE,catalogs:[{id:'en',locale:'en',path:'cat.json',sha256:sha256(cat)}],contracts:[{messageId:'m',variables:[{name:'n',domain:{kind:'integer-range',min:0,max}}]}],...(limits?{limits:{...HARD,...limits}}:{})};
  return {manifestBytes:Buffer.from(JSON.stringify(manifest)),catalogsById:new Map([['en',cat]])};
}
test('independent review: reject fractional JSON values before floating-point rounding',()=>{
  for(const token of ['1.00000000000000000000000000001','9007199254740991.1','1e-99999','0.000000000000000000000001','-9007199254740991.1'])assert.throws(()=>strictJSON(Buffer.from(token)),e=>e.code==='json-number',token);
  for(const token of ['1.0','1000e-3','0.000e9999','900719925474099100e-2'])assert(Number.isSafeInteger(strictJSON(Buffer.from(token))),token);
});
test('independent review: mask budget charges local and ancestor intersections',()=>{
  assert.throws(()=>buildAnalysis(single(undefined,64,{maskWordOps:76})),e=>e.status==='incomplete');
  const a=buildAnalysis(single(undefined,64,{maskWordOps:77}));
  assert.equal(a.counts.maskWordOps,77);
});
test('independent review: replay snapshots pack and all source bytes at entry',async()=>{
  const a=await analyzeCatalog(single());assert.equal(a.status,'analyzed');
  const pack=await generateCases(a.analysis);assert.equal(pack.status,'complete');
  const input={...single(),packBytes:Buffer.from(canonical(pack))};
  const pending=replayCases(input);input.packBytes.fill(0);input.manifestBytes.fill(0);input.catalogsById.get('en').fill(0);input.catalogsById.clear();
  const r=await pending;assert.equal(r.status,'verified',JSON.stringify(r));
  assert(Object.isFrozen(r));assert(Object.isFrozen(r.verifiedCaseIds));
  const rejected=await generateCases(structuredClone(a.analysis));assert.equal(rejected.status,'invalid');assert(Object.isFrozen(rejected.diagnostics[0]));
});
test('independent review: API rejects shared input buffers and oversize snapshots',async()=>{
  for(const slot of ['manifest','catalog','pack']){
    const x=single();if(slot==='manifest')x.manifestBytes=new Uint8Array(new SharedArrayBuffer(8));
    if(slot==='catalog')x.catalogsById.set('en',new Uint8Array(new SharedArrayBuffer(8)));
    const r=slot==='pack'?await replayCases({...x,packBytes:new Uint8Array(new SharedArrayBuffer(8))}):await analyzeCatalog(x);
    assert.equal(r.status,'invalid',slot);assert.equal(r.diagnostics[0].code,'input-type',slot);
  }
  assert.equal((await analyzeCatalog({...single(),manifestBytes:new Uint8Array(2*1024*1024+1)})).status,'incomplete');
});
test('independent review: strict paths, symlink parents, regular files and hardlink aliases',async()=>{
  for(const p of ['../x','x/../y','/x','x//y','x/./y','https://example.test/x','file:x','x\\y','x\0y'])assert.throws(()=>safeRelativePath(p),p);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchlingo-review-files-'));
  try {
    const nested=path.join(dir,'real');await fs.mkdir(nested);await fs.writeFile(path.join(nested,'input'),'abc');await fs.symlink(nested,path.join(dir,'link'));
    await assert.rejects(readRegular(path.join(dir,'link','input'),3),e=>e.code==='symlink');
    await assert.rejects(readRegular(nested,3),e=>e.code==='regular-file');
    const r=await readRegular(path.join(nested,'input'),3);assert.equal(r.bytes.length,3);
    await assert.rejects(readRegular(path.join(nested,'input'),2),e=>e.status==='incomplete');
    const alias=path.join(dir,'alias');await fs.link(path.join(nested,'input'),alias);
    await assert.rejects(installOutput(alias,Buffer.from('replacement'),[r.identity]),e=>e.code==='input-alias');assert.equal(await fs.readFile(alias,'utf8'),'abc');
    await assert.rejects(installOutput(path.join(dir,'link','out'),Buffer.from('replacement')),e=>e.code==='symlink');
    const fifo=path.join(dir,'fifo');const made=spawnSync('mkfifo',[fifo],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
    await assert.rejects(readRegular(fifo,20),e=>e.code==='regular-file');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('independent review: invalid CLI options preserve requested JSON stream',()=>{
  for(const args of [['generate',path.join(root,'examples/manifest.json'),'--out','unused','--json','--wat'],['generate','--json']]){
    const r=spawnSync(process.execPath,[path.join(root,'bin/branchlingo.mjs'),...args],{encoding:'utf8'});
    assert.equal(r.status,2);assert.equal(r.stderr,'');assert.equal(JSON.parse(r.stdout).status,'invalid');
  }
});
test('independent review: fingerprint actual nested formatter dependency entries',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchlingo-review-package-'));
  try {
    for(const item of ['src','bin','schemas','package.json','runtime-lock.json','node_modules'])await fs.cp(path.join(root,item),path.join(dir,item),{recursive:true});
    const nested=path.join(dir,'node_modules/intl-messageformat/node_modules/@formatjs/fast-memoize');
    await fs.cp(path.join(root,'node_modules/@formatjs/fast-memoize'),nested,{recursive:true});
    await fs.appendFile(path.join(nested,'index.js'),'\nglobalThis.branchlingoReviewNested = true;\n');
    const code=`import {runtimeIdentity} from './src/runtime.mjs';let result;try{runtimeIdentity();result={status:'accepted'}}catch(e){result={status:'rejected',code:e.code}}console.log(JSON.stringify({...result,nestedLoaded:globalThis.branchlingoReviewNested===true}));`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:dir,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
    const result=JSON.parse(child.stdout);assert.equal(result.nestedLoaded,true);assert.equal(result.status,'rejected');assert.equal(result.code,'dependency-mismatch');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('independent review: recognized hard size caps report incomplete consistently',async()=>{
  for(const text of ['a'.repeat(65537),'😀'.repeat(32769)]){
    const cat=Buffer.from(JSON.stringify({kind:'branchlingo-catalog',schemaVersion:1,messages:[{id:'m',text}]}));
    const m={kind:'branchlingo-manifest',schemaVersion:1,profile:PROFILE,catalogs:[{id:'en',locale:'en',path:'cat.json',sha256:sha256(cat)}],contracts:[{messageId:'m',variables:[]}]};
    const r=await analyzeCatalog({manifestBytes:Buffer.from(JSON.stringify(m)),catalogsById:new Map([['en',cat]])});assert.equal(r.status,'incomplete');assert.equal(r.diagnostics[0].code,'resource-limit');
  }
  for(const values of [Array.from({length:257},(_,i)=>''+i),['a'.repeat(4097)],['😀'.repeat(2049)]]){
    const cat=Buffer.from(JSON.stringify({kind:'branchlingo-catalog',schemaVersion:1,messages:[{id:'m',text:'{s}'}]}));
    const m={kind:'branchlingo-manifest',schemaVersion:1,profile:PROFILE,catalogs:[{id:'en',locale:'en',path:'cat.json',sha256:sha256(cat)}],contracts:[{messageId:'m',variables:[{name:'s',domain:{kind:'string-enum',values}}]}]};
    const r=await analyzeCatalog({manifestBytes:Buffer.from(JSON.stringify(m)),catalogsById:new Map([['en',cat]])});assert.equal(r.status,'incomplete');assert.equal(r.diagnostics[0].code,'resource-limit');
  }
});
test('independent review: generic schema strings retain code-point length semantics',async()=>{
  const x=single();const manifest=JSON.parse(Buffer.from(x.manifestBytes));const id='😀'.repeat(100);manifest.catalogs[0].id=id;
  const r=await analyzeCatalog({manifestBytes:Buffer.from(JSON.stringify(manifest)),catalogsById:new Map([[id,x.catalogsById.get('en')]])});
  assert.equal(r.status,'analyzed',JSON.stringify(r));
});
