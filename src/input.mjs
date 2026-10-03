import schema from '../schemas/bundle.schema.json' with {type:'json'};
import {strictJSON,canonical,sha256} from './codec.mjs';
import {invalid,incomplete,mismatch} from './errors.mjs';
export const PROFILE='formatjs-mf1-finite-v1';
export const HARD=Object.freeze({dispatchEvaluations:10_000_000,maskWordOps:10_000_000,astNodes:50_000,arms:10_000,witnessCases:10_000,renderWork:10_000_000,packBytes:16*1024*1024});
function codePointLength(s) { let n=0; for(const ignored of s) n++; return n; }
export function checkShape(v,name){
  function ok(x,s){
    if(s.$ref)return ok(x,schema.$defs[s.$ref.split('/').at(-1)]);
    if(s.const!==undefined&&x!==s.const)return false;
    if(s.enum&&!s.enum.includes(x))return false;
    if(s.oneOf&&s.oneOf.filter(t=>ok(x,t)).length!==1)return false;
    if(s.type==='null'&&x!==null)return false;
    if(s.type==='boolean'&&typeof x!=='boolean')return false;
    if(s.type==='integer'&&(!Number.isSafeInteger(x)||Object.is(x,-0)||x<s.minimum||x>s.maximum))return false;
    if(s.type==='string'&&typeof x==='string'&&codePointLength(x)>(s.maxLength??Infinity))incomplete('String schema resource limit exceeded');
    if(s.type==='array'&&Array.isArray(x)&&x.length>(s.maxItems??Infinity))incomplete('Array schema resource limit exceeded');
    if(s.type==='string'&&(typeof x!=='string'||!x.isWellFormed()||codePointLength(x)<(s.minLength??0)||codePointLength(x)>(s.maxLength??Infinity)||(s.pattern&&!new RegExp(s.pattern).test(x))))return false;
    if(s.type==='array'&&(!Array.isArray(x)||x.length<(s.minItems??0)||x.length>(s.maxItems??Infinity)||x.some(e=>!ok(e,s.items))))return false;
    if(s.type==='object'){
      if(!x||typeof x!=='object'||Array.isArray(x))return false;
      if((s.required??[]).some(k=>!Object.hasOwn(x,k)))return false;
      for(const k of Object.keys(x)){if(!Object.hasOwn(s.properties,k)){if(s.additionalProperties===false)return false;}else if(!ok(x[k],s.properties[k]))return false;}
    }
    return true;
  }
  if(!ok(v,schema.$defs[name]))invalid('schema',`Invalid ${name} shape`);return v;
}
export const validatePackShape=p=>checkShape(p,'pack');
export function safeRelativePath(p){
  if(typeof p!=='string'||!p||p.includes('\0')||p.includes('\\')||p.startsWith('/')||/^[a-z][a-z0-9+.-]*:/i.test(p)||p.split('/').some(s=>!s||s==='.'||s==='..'))invalid('catalog-path','Catalog paths must be contained relative local paths without symlinks');return p;
}
export function localeInfo(locale){
  let canonicalLocale;
  try{canonicalLocale=Intl.getCanonicalLocales(locale)[0];}catch{invalid('unsupported-locale','Malformed locale');}
  if(!canonicalLocale||canonicalLocale.split('-').some(s=>s.length===1)||!Intl.PluralRules.supportedLocalesOf([canonicalLocale],{localeMatcher:'lookup'}).length||!Intl.NumberFormat.supportedLocalesOf([canonicalLocale],{localeMatcher:'lookup'}).length)invalid('unsupported-locale','Unsupported locale or locale extension');
  return canonicalLocale;
}
function unique(items,key,label){const m=new Map();for(const item of items){const k=key(item);if(m.has(k))invalid('duplicate-id',`Duplicate ${label}`);m.set(k,item);}return m;}
export function validateInputs({manifestBytes,catalogsById}){
  const manifest=checkShape(strictJSON(manifestBytes,{maxBytes:2*1024*1024}),'manifest');
  if(!(catalogsById instanceof Map))invalid('input-type','catalogsById must be a Map');
  const refs=unique(manifest.catalogs,c=>c.id,'catalog ID');
  if(catalogsById.size!==refs.size||[...catalogsById.keys()].some(id=>!refs.has(id)))invalid('catalog-set','Catalog byte map must exactly match the explicit manifest IDs');
  manifest.catalogs.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);manifest.contracts.sort((a,b)=>a.messageId<b.messageId?-1:a.messageId>b.messageId?1:0);
  const contracts=unique(manifest.contracts,c=>c.messageId,'contract');let domainSum=0n;
  for(const c of contracts.values()){
    unique(c.variables,v=>v.name,'variable');c.variables.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    c.bindings=new Map();
    for(const v of c.variables){const d=v.domain;let count;
      if(d.kind==='integer-range'){if(d.min>d.max)invalid('domain','Range minimum exceeds maximum');count=BigInt(d.max)-BigInt(d.min)+1n;if(count>10001n)incomplete('Integer domain cardinality limit exceeded');}
      else if(d.kind==='string-enum'){if(new Set(d.values).size!==d.values.length)invalid('domain','Duplicate string domain value');d.values.sort();for(const s of d.values)if(s.length>4096||Buffer.byteLength(s)>16384)incomplete('String domain value limit exceeded');count=BigInt(d.values.length);}
      else{if(typeof d.value==='string'&&(d.value.length>4096||Buffer.byteLength(d.value)>16384))incomplete('Sample value limit exceeded');count=1n;}
      domainSum+=count;if(domainSum>100000n)incomplete('Aggregate domain cardinality limit exceeded');c.bindings.set(v.name,{name:v.name,domain:d,size:Number(count)});
    }
  }
  const sources=[],scopes=[],seenIds=new Set();let rawBytes=manifestBytes.length;let messages=0;
  for(const ref of manifest.catalogs){safeRelativePath(ref.path);const locale=localeInfo(ref.locale);const bytes=catalogsById.get(ref.id);if(!(bytes instanceof Uint8Array))invalid('input-type','Catalog must contain UTF-8 bytes');rawBytes+=bytes.length;if(rawBytes>2*1024*1024)incomplete('Aggregate source byte limit exceeded');
    if(sha256(bytes)!==ref.sha256)mismatch('Catalog source hash differs from the manifest');
    const cat=checkShape(strictJSON(bytes,{maxBytes:2*1024*1024}),'catalog');unique(cat.messages,m=>m.id,'message');messages+=cat.messages.length;if(messages>1000)incomplete('Aggregate message limit exceeded');
    sources.push({catalogId:ref.id,locale,sha256:ref.sha256,byteLength:bytes.length});
    for(const m of cat.messages){if(m.text.length>65536||Buffer.byteLength(m.text)>262144)incomplete('Message length limit exceeded');if(!contracts.has(m.id))invalid('contract','Missing message contract');seenIds.add(m.id);scopes.push({catalogId:ref.id,messageId:m.id,locale,sourceHash:ref.sha256,text:m.text,contract:contracts.get(m.id)});}
  }
  if([...contracts.keys()].some(k=>!seenIds.has(k)))invalid('contract','Unused message contract');
  // Maps are private metadata, never part of normalized manifest JSON.
  const normalized=Object.assign(Object.create(null),manifest,{contracts:manifest.contracts.map(c=>({messageId:c.messageId,variables:c.variables}))});
  return {manifest:normalized,manifestSha256:sha256(manifestBytes),sources,scopes,contracts,limits:{...HARD,...manifest.limits},domainSum:Number(domainSum),rawBytes};
}
