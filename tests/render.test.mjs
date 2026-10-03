import test from 'node:test';import assert from 'node:assert/strict';
import {markerPrefix,extractMarkers} from '../src/render.mjs';
test('collision-safe markers preserve payload and ordered IDs',()=>{const a='a'.repeat(64),b='b'.repeat(64),known=new Set([a,b]);for(const text of ['', '\ue000'.repeat(64), '\ue000\ue001\ue002abc', 'hello'])for(let i=0;i<=text.length;i++){const p=markerPrefix(text);const marked=text.slice(0,i)+p+a+'\ue002'+p+b+'\ue002'+text.slice(i);assert.deepEqual(extractMarkers(marked,p,known),{output:text,trace:[a,b]});}});
test('unknown or malformed marker is a mismatch',()=>{assert.throws(()=>extractMarkers('\ue000\ue001fake\ue002','\ue000\ue001',new Set()),e=>e.status==='mismatch');});
test('exhaustive short marker payloads and long boundary runs preserve exact text',()=>{
 const ids=['a'.repeat(64),'b'.repeat(64)],known=new Set(ids),alphabet=['\ue000','\ue001','\ue002','a'];let frontier=[''],checked=0;
 for(let length=0;length<=6;length++){
  for(const original of frontier){const prefix=markerPrefix(original),left=prefix+ids[0]+'\ue002',right=prefix+ids[1]+'\ue002';for(let first=0;first<=original.length;first++)for(let second=first;second<=original.length;second++){
   const marked=original.slice(0,first)+left+original.slice(first,second)+right+original.slice(second);assert.deepEqual(extractMarkers(marked,prefix,known),{output:original,trace:ids});checked++;
  }}if(length<6)frontier=frontier.flatMap(s=>alphabet.map(ch=>s+ch));
 }
 assert.equal(checked,140781);
 for(const length of [7,31,255,4096,65535]){const original='\ue000'.repeat(length)+'\ue001\ue002';const prefix=markerPrefix(original);assert.deepEqual(extractMarkers(original+prefix+ids[0]+'\ue002',prefix,known),{output:original,trace:[ids[0]]});}
});
