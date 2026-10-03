// Independent hard-boundary checks. Runs only against the pinned supported runtime.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildAnalysis} from '../src/analyze.mjs';
import {execute} from '../src/engine.mjs';
import {renderCase} from '../src/render.mjs';
import {sha256} from '../src/codec.mjs';
import {PROFILE} from '../src/input.mjs';
import {analyzeCatalog} from '../src/index.mjs';
let checks=0;
function input(messages,contracts,{catalogs=1}={}) {
  const cat=Buffer.from(JSON.stringify({kind:'branchlingo-catalog',schemaVersion:1,messages}));
  const refs=Array.from({length:catalogs},(_,i)=>({id:'c'+i,locale:'en',path:'cat.json',sha256:sha256(cat)}));
  const manifest={kind:'branchlingo-manifest',schemaVersion:1,profile:PROFILE,catalogs:refs,contracts};
  return {manifestBytes:Buffer.from(JSON.stringify(manifest)),catalogsById:new Map(refs.map(c=>[c.id,cat]))};
}
const one=(text,variables=[])=>input([{id:'m',text}],[{messageId:'m',variables}]);
function check(label,snapshot,expected='analyzed',mode='analyze') {
  const result=execute(mode,snapshot);assert.equal(result.status,expected,label+': '+JSON.stringify(result.diagnostics));
  if(expected==='incomplete'){assert.equal(result.diagnostics[0].code,'resource-limit',label);assert.equal(result.coverageClaim,undefined,label);}
  checks++;return result;
}
for(const n of [65535,65536,65537])check('message units '+n,one('a'.repeat(n)),n>65536?'incomplete':'analyzed');
for(const n of [10000,10001,10002])check('range values '+n,one('{n}',[{name:'n',domain:{kind:'integer-range',min:0,max:n-1}}]),n>10001?'incomplete':'analyzed');
for(const n of [255,256,257])check('enum values '+n,one('{s}',[{name:'s',domain:{kind:'string-enum',values:Array.from({length:n},(_,i)=>''+i)}}]),n>256?'incomplete':'analyzed');
for(const sum of [99999,100000,100001]){
  const variables=Array.from({length:10},(_,i)=>({name:'n'+i,domain:{kind:'integer-range',min:0,max:i===0?sum-90001:9999}}));
  check('aggregate domains '+sum,one(variables.map(v=>'{'+v.name+'}').join(''),variables),sum>100000?'incomplete':'analyzed');
}
for(const n of [31,32,33])check('selector depth '+n,one('{n,plural,other{'.repeat(n)+'x'+'}}'.repeat(n),[{name:'n',domain:{kind:'integer-range',min:0,max:0}}]),n>32?'incomplete':'analyzed');
for(const n of [1023,1024,1025])check('selector options '+n,one('{s,select,'+Array.from({length:n-1},(_,i)=>'k'+i+'{}').join('')+'other{}}',[{name:'s',domain:{kind:'string-enum',values:['unmatched']}}]),n>1024?'incomplete':'analyzed');
for(const n of [999,1000,1001])check('messages '+n,input(Array.from({length:n},(_,i)=>({id:'m'+i,text:''})),Array.from({length:n},(_,i)=>({messageId:'m'+i,variables:[]}))),n>1000?'incomplete':'analyzed');
for(const n of [15,16,17])check('catalogs '+n,input([{id:'m',text:''}],[{messageId:'m',variables:[]}],{catalogs:n}),n>16?'incomplete':'analyzed');
for(const n of [49999,50000,50001]){
  const sizes=Array.from({length:4},(_,i)=>i===0?n-37500:12500);
  check('AST nodes '+n,input(sizes.map((size,i)=>({id:'m'+i,text:'{n}'.repeat(size)})),sizes.map((_,i)=>({messageId:'m'+i,variables:[{name:'n',domain:{kind:'sample',value:0}}]}))),n>50000?'incomplete':'analyzed');
}
for(const n of [9999,10000,10001]){
  const sizes=Array.from({length:20},(_,i)=>i===0?n-9500:500);
  check('arms '+n,input(sizes.map((size,i)=>({id:'m'+i,text:'{s,select,'+Array.from({length:size-1},(_,i)=>'k'+i+'{}').join('')+'other{}}'})),sizes.map((_,i)=>({messageId:'m'+i,variables:[{name:'s',domain:{kind:'string-enum',values:['unmatched']}}]}))),n>10000?'incomplete':'analyzed');
}
for(const delta of [-1,0,1]){
  const text='{x}'.repeat(255)+(delta<0?'{y}':'{x}'+(delta?'x':''));
  const variables=[{name:'x',domain:{kind:'sample',value:'x'.repeat(4096)}},...(delta<0?[{name:'y',domain:{kind:'sample',value:'x'.repeat(4095)}}]:[])];
  check('original bytes '+(1048576+delta),one(text,variables),delta>0?'incomplete':'complete','generate');
}
// One marker adds (3 * (P-run + 1) + 70) bytes; nearest realizable sizes straddle 2 MiB.
for(const extra of [1352,1353,1354]){
  const text='{x}'.repeat(85)+'\ue000'.repeat(extra)+'{s,select,other{}}';
  const variables=[{name:'x',domain:{kind:'sample',value:'\ue000'.repeat(4096)}},{name:'s',domain:{kind:'string-enum',values:['other']}}];
  check('marked bound '+(2*3*(85*4096+extra)+73),one(text,variables),extra>1353?'incomplete':'complete','generate');
}
// Exercise the run ledger separately: final serialization has its own smaller limit.
const aggregate=input(Array.from({length:17},(_,i)=>({id:'m'+i,text:'{x}'.repeat(256)})),Array.from({length:17},(_,i)=>({messageId:'m'+i,variables:[{name:'x',domain:{kind:'sample',value:'x'.repeat(4096)}}]})));
const analysis=buildAnalysis(aggregate);
for(let i=0;i<16;i++){renderCase(analysis.cases[i].scope,analysis.cases[i].spec,analysis.budget);assert.equal(analysis.budget.outputBytes,(i+1)*2*1024*1024);checks++;}
assert.throws(()=>renderCase(analysis.cases[16].scope,analysis.cases[16].spec,analysis.budget),e=>e.status==='incomplete'&&e.code==='resource-limit');checks++;
for(const selectors of [82,83,84]){
  const snapshot=one('{n,plural,other{}}'.repeat(selectors),[{name:'n',domain:{kind:'integer-range',min:0,max:10000}}]);
  if(selectors<84){const a=buildAnalysis(snapshot);assert(a.estimates.controlledBytes<=64*1024*1024);}
  else assert.throws(()=>buildAnalysis(snapshot),e=>e.status==='incomplete'&&e.message.includes('Controlled allocation'));
  checks++;
}
const manifest=readFileSync(new URL('../examples/manifest.json',import.meta.url)),catalog=readFileSync(new URL('../examples/files.json',import.meta.url)),sourceCap=2*1024*1024;
for(const delta of [-1,0,1]){
  const padded=Buffer.concat([manifest,Buffer.alloc(sourceCap+delta-catalog.length*3-manifest.length,32)]);
  const result=await analyzeCatalog({manifestBytes:padded,catalogsById:new Map(['en','fr','ja'].map(id=>[id,catalog]))});
  assert.equal(result.status,delta>0?'incomplete':'analyzed','source byte cap '+(sourceCap+delta));checks++;
}
console.log(JSON.stringify({status:'passed',checks,note:'Conservative limits may reject before other absolute ceilings; this is not an RSS bound.'}));
