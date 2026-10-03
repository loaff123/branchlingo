import test from 'node:test';
import assert from 'node:assert/strict';
import {strictJSON,canonical,sha256,deepFreeze} from '../src/codec.mjs';
const bytes=s=>new TextEncoder().encode(s);
test('strict UTF-8 JSON rejects silent normalization and duplicate keys',()=>{
 for(const s of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','-0','-0.0','-0e0','1e999','9007199254740992','"\\ud800"','"\\udfff"','\ufeff{}','NaN','{} trailing','[1,]'])assert.throws(()=>strictJSON(bytes(s)),s);
 for(const b of [[0xc0,0x80],[0xed,0xa0,0x80],[0xff]])assert.throws(()=>strictJSON(Uint8Array.from(b)));
});
test('prototype-like JSON keys remain own data',()=>{let v=strictJSON(bytes('{"__proto__":{"constructor":"yes"}}'));assert.equal(Object.getPrototypeOf(v),null);assert.equal(v.__proto__.constructor,'yes');});
test('depth, byte limits, canonical order and freeze',()=>{
 assert.throws(()=>strictJSON(bytes('['.repeat(65)+'0'+']'.repeat(65))));
 assert.throws(()=>strictJSON(bytes('{}'),{maxBytes:1}));
 assert.equal(canonical({z:1,a:'😀'}),'{"a":"😀","z":1}');
 assert.equal(sha256('x').length,64);const v=deepFreeze({a:[{b:2}]});assert.throws(()=>v.a[0].b=3);assert.throws(()=>canonical({a:'xx'},{maxBytes:3}));
});
test('numeric validation uses exact JSON decimal value before IEEE rounding',()=>{for(const s of ['1.0000000000000001','9007199254740990.1','1e-400','-1e-400'])assert.throws(()=>strictJSON(bytes(s)),s);for(const [s,n] of [['1.0',1],['100e-2',1],['0e999',0],['1e3',1000]])assert.equal(strictJSON(bytes(s)),n);});
test('unexpected operational exceptions use stable internal diagnostic codes',async()=>{const {failure}=await import('../src/errors.mjs');const error=Object.assign(new Error('/private/example'),{code:'ENOENT'});const report=failure(error);assert.equal(report.diagnostics[0].code,'internal-error');assert(!JSON.stringify(report).includes('/private'));});
