import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from '@formatjs/icu-messageformat-parser';
import {preflightMF1,PARSER_OPTIONS} from '../src/preflight.mjs';
import {execute} from '../src/engine.mjs';
import {canonical} from '../src/codec.mjs';

function originalInput(){
  const manifestBytes=fs.readFileSync(new URL('../examples/manifest.json',import.meta.url));
  const catalog=fs.readFileSync(new URL('../examples/files.json',import.meta.url));
  return {manifestBytes,catalogsById:new Map(['en','fr','ja'].map(id=>[id,catalog]))};
}

function collectMutations(value,path=[],mutations=[]){
  if(value&&typeof value==='object'){
    if(Array.isArray(value)){
      if(value.length)mutations.push({path,kind:'remove-array-item',change:array=>array.pop()});
      if(value.length>1)mutations.push({path,kind:'swap-array-items',change:array=>{[array[0],array[1]]=[array[1],array[0]];}});
      if(value.length)mutations.push({path,kind:'duplicate-array-item',change:array=>array.push(structuredClone(array[0]))});
      for(let index=0;index<value.length;index++)collectMutations(value[index],[...path,index],mutations);
    }else{
      for(const key of Object.keys(value)){
        mutations.push({path,kind:`omit:${key}`,change:record=>{delete record[key];}});
        collectMutations(value[key],[...path,key],mutations);
      }
    }
  }else{
    const replacement=typeof value==='string'?value+'x':typeof value==='number'?value+1:typeof value==='boolean'?!value:'not-null';
    mutations.push({path,kind:'replace-scalar',replacement});
  }
  return mutations;
}

test('hostile replay rejects every worked-pack field mutation and structural omission',context=>{
  const input=originalInput();
  const pack=execute('generate',input);
  assert.equal(pack.status,'complete',JSON.stringify(pack));
  assert.equal(execute('replay',{...input,packBytes:Buffer.from(canonical(pack))}).status,'verified');
  const mutations=collectMutations(pack);
  const statuses={invalid:0,mismatch:0,incomplete:0};
  for(const mutation of mutations){
    const changed=structuredClone(pack);
    let parent=changed;
    for(const key of mutation.path.slice(0,-1))parent=parent[key];
    if(mutation.kind==='replace-scalar')parent[mutation.path.at(-1)]=mutation.replacement;
    else mutation.change(mutation.path.length?parent[mutation.path.at(-1)]:changed);
    const replay=execute('replay',{...input,packBytes:Buffer.from(JSON.stringify(changed))});
    assert.ok(replay.status==='invalid'||replay.status==='mismatch'||replay.status==='incomplete',`${mutation.kind} at ${JSON.stringify(mutation.path)} returned ${replay.status}`);
    if(replay.status==='incomplete')assert.equal(replay.diagnostics[0].code,'resource-limit','an internal failure must not count as a successful hostile-input refusal');
    statuses[replay.status]++;
  }
  const equivalentManifest=Buffer.from(JSON.stringify(JSON.parse(input.manifestBytes),null,2));
  assert.notDeepEqual(equivalentManifest,input.manifestBytes);
  assert.equal(execute('replay',{...input,manifestBytes:equivalentManifest,packBytes:Buffer.from(canonical(pack))}).status,'mismatch');
  assert.equal(mutations.length,1984);
  context.diagnostic(`${mutations.length} mutations rejected: ${statuses.invalid} invalid, ${statuses.mismatch} mismatch, ${statuses.incomplete} explicit resource refusals; equivalent JSON with changed manifest bytes also refused`);
});

function* words(alphabet,length,prefix=''){
  if(length===0){yield prefix;return;}
  for(const character of alphabet)yield* words(alphabet,length-1,prefix+character);
}

test('quote-aware guard agrees with pinned parser across an exhaustive small alphabet and seeded nested corpus',context=>{
  const alphabet=['a',"'",'{','}','#','<','>'];
  const stats={checks:0,accepted:0,rejected:0,unsupported:0};
  function inspect(text){
    stats.checks++;
    let ast;
    try{ast=parse(text,PARSER_OPTIONS);}catch{
      stats.rejected++;
      assert.throws(()=>preflightMF1(text),`guard admitted parser-rejected quote corpus member ${JSON.stringify(text)}`);
      return;
    }
    let arms=0,maxDepth=0,supported=true;
    const stack=ast.map(node=>({node,depth:0}));
    while(stack.length){
      const {node,depth}=stack.pop();
      if(![0,1,5,6,7].includes(node.type)){supported=false;break;}
      if(node.type!==5&&node.type!==6)continue;
      maxDepth=Math.max(maxDepth,depth+1);
      for(const [label,option] of Object.entries(node.options)){
        if(node.type===6&&!['zero','one','two','few','many','other'].includes(label)&&!/^=(?:0|-?[1-9][0-9]*)$/.test(label))supported=false;
        arms++;
        for(const child of option.value)stack.push({node:child,depth:depth+1});
      }
    }
    if(!supported){stats.unsupported++;return;}
    const guarded=preflightMF1(text);
    assert.equal(guarded.arms,arms,JSON.stringify(text));
    assert.equal(guarded.maxDepth,maxDepth,JSON.stringify(text));
    stats.accepted++;
  }
  for(let length=0;length<=6;length++)for(const text of words(alphabet,length))inspect(text);
  const seed=0xb42f12d3;
  let state=seed;
  function random(maximum){state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)%maximum;}
  const forms=['{x,select,a{%}other{z}}','{n,plural,one{%}other{z}}','{n,selectordinal,offset:-1 one{%}other{#}}'];
  for(let index=0;index<60000;index++){
    let text='';
    for(let character=0,length=random(18);character<length;character++)text+=alphabet[random(alphabet.length)];
    for(let depth=0,total=1+random(5);depth<total;depth++)text=forms[random(forms.length)].replace('%',text);
    inspect(text);
  }
  assert.deepEqual(stats,{checks:197257,accepted:75580,rejected:121616,unsupported:61});
  context.diagnostic(`seed=0xb42f12d3; ${stats.checks} cases; ${stats.accepted} supported AST agreements; ${stats.rejected} shared rejections; ${stats.unsupported} intentionally unsupported parser ASTs`);
});
