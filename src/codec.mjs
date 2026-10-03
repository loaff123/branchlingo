import {createHash} from 'node:crypto';
import {invalid,incomplete} from './errors.mjs';
export const sha256 = input => createHash('sha256').update(input).digest('hex');
export function strictJSON(bytes, {maxBytes = 16 * 1024 * 1024, depth = 64} = {}) {
  if (!(bytes instanceof Uint8Array)) invalid('input-type','Expected UTF-8 byte buffers');
  if (bytes.byteLength > maxBytes) incomplete('JSON byte limit exceeded');
  if (bytes[0]===239 && bytes[1]===187 && bytes[2]===191) invalid('json-bom','A UTF-8 BOM is not accepted');
  let s;
  try { s = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { invalid('json-utf8','Invalid UTF-8'); }
  let i = 0;
  const bad = () => invalid('json-syntax',`Invalid strict JSON at UTF-16 offset ${i}`);
  const ws = () => { while (i<s.length && /[ \t\r\n]/.test(s[i])) i++; };
  function string() {
    const start=i++;
    while(i<s.length) {
      const c=s.charCodeAt(i++);
      if(c===34) {
        let value;
        try { value=JSON.parse(s.slice(start,i)); } catch { bad(); }
        if(!value.isWellFormed()) invalid('json-surrogate','Lone UTF-16 surrogate is not accepted');
        return value;
      }
      if(c<32) bad();
      if(c===92) {
        if(i>=s.length) bad();
        const e=s[i++];
        if(e==='u') { if(!/^[0-9a-fA-F]{4}$/.test(s.slice(i,i+4))) bad(); i+=4; }
        else if(!'"\\/bfnrt'.includes(e)) bad();
      }
    }
    bad();
  }
  function value(level) {
    ws(); const c=s[i];
    if(c==='"') return string();
    if(c==='{'||c==='[') {
      if(level>=depth) incomplete('JSON nesting limit exceeded');
      const obj=c==='{'?Object.create(null):[]; const end=c==='{'?'}':']'; i++;ws();
      if(s[i]===end) {i++;return obj;}
      for(;;) {
        if(c==='{') {
          if(s[i]!=='"') bad();const key=string();ws();if(s[i++]!==':')bad();
          if(Object.hasOwn(obj,key))invalid('json-duplicate-key','Duplicate JSON object key');
          obj[key]=value(level+1);
        } else obj.push(value(level+1));
        ws();if(s[i]===end){i++;return obj;}if(s[i++]!==',')bad();ws();
      }
    }
    for(const [token,v] of [['true',true],['false',false],['null',null]])if(s.startsWith(token,i)){i+=token.length;return v;}
    const m=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(s.slice(i));
    if(!m)bad();i+=m[0].length;
    // Establish the exact decimal value before IEEE-754 conversion can round it.
    const token=m[0],negative=token[0]==='-',unsigned=negative?token.slice(1):token;
    const [mantissa,exponentText='0']=unsigned.toLowerCase().split('e');
    const point=mantissa.indexOf('.'),fraction=point<0?0:mantissa.length-point-1;
    let digits=mantissa.replace('.','').replace(/^0+/,'');
    if(!digits){if(negative)invalid('json-number','Negative zero is not accepted');return 0;}
    const before=digits.length;digits=digits.replace(/0+$/,'');
    const power=Number(exponentText)-fraction+(before-digits.length);
    if(!Number.isSafeInteger(power)||power<0||digits.length+power>16)invalid('json-number','Only exact safe integer JSON numbers are accepted');
    const exact=BigInt(digits+'0'.repeat(power))*(negative?-1n:1n);
    if(exact<BigInt(Number.MIN_SAFE_INTEGER)||exact>BigInt(Number.MAX_SAFE_INTEGER))invalid('json-number','Only exact safe integer JSON numbers are accepted');
    return Number(exact);
  }
  const result=value(0);ws();if(i!==s.length)bad();return result;
}
export function canonical(value,{maxBytes=16*1024*1024}={}) {
  const chunks=[];let bytes=0;
  function emit(s) {bytes+=Buffer.byteLength(s);if(bytes>maxBytes)incomplete('Serialized JSON byte limit exceeded');chunks.push(s);}
  function write(v,depth) {
    if(depth>128)incomplete('Serialization nesting limit exceeded');
    if(v===null){emit('null');return;}
    if(typeof v==='string'){if(!v.isWellFormed())invalid('json-surrogate','Lone surrogate');emit(JSON.stringify(v));return;}
    if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))invalid('json-number','Unsafe numeric value');emit(String(v));return;}
    if(typeof v==='boolean'){emit(String(v));return;}
    if(!v||typeof v!=='object')invalid('json-type','Unsupported JSON value');
    if(Array.isArray(v)){emit('[');for(let i=0;i<v.length;i++){if(i)emit(',');write(v[i],depth+1);}emit(']');}
    else {emit('{');const keys=Object.keys(v).sort();for(let i=0;i<keys.length;i++){if(i)emit(',');write(keys[i],depth+1);emit(':');write(v[keys[i]],depth+1);}emit('}');}
  }
  write(value,0);return chunks.join('');
}
export function deepFreeze(value) {
  const todo=[value];const seen=new WeakSet();while(todo.length){const v=todo.pop();if(v&&typeof v==='object'&&!seen.has(v)){seen.add(v);todo.push(...Object.values(v));Object.freeze(v);}}return value;
}
export function exactKeys(value,required,optional=[]) {
  if(value===null||typeof value!=='object'||Array.isArray(value))invalid('schema','Expected a record');
  const allowed=new Set([...required,...optional]);if(required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!allowed.has(k)))invalid('schema','Missing or unknown record field');
}
