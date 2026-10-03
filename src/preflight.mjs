import {invalid,incomplete} from './errors.mjs';
export const PARSER_OPTIONS=Object.freeze({captureLocation:true,ignoreTag:false,requiresOtherClause:true,shouldParseSkeletons:false});
// This is a bounded grammar guard, not an AST parser. The pinned parser remains authoritative.
export function preflightMF1(text){
  if(text.length>65536||Buffer.byteLength(text)>262144)incomplete('Message length limit exceeded');
  let i=0,tokens=0,arms=0,maxDepth=0;
  const stack=[{kind:'body',type:null,depth:0,root:true}];
  const bad=message=>invalid('mf1-syntax',`${message} at UTF-16 offset ${i}`);
  const space=()=>{while(i<text.length&&/[\u0009-\u000d\u0020\u0085\u200e\u200f\u2028\u2029]/u.test(text[i]))i++;};
  const identifier=()=>{const start=i;while(i<text.length&&!/[\p{Pattern_Syntax}\p{White_Space}]/u.test(text[i])){const cp=text.codePointAt(i);i+=cp>65535?2:1;}return text.slice(start,i);};
  function quote(type){
    if(text[i+1]==="'"){i+=2;return;}
    const next=text[i+1];
    if(!'{<>}'.includes(next??'\0')&&!(next==='#'&&(type==='plural'||type==='selectordinal'))){i++;return;}
    i+=2;
    while(i<text.length){if(text[i]==="'"){if(text[i+1]==="'"){i+=2;continue;}i++;return;}i++;}
  }
  while(stack.length){
    if(++tokens>200000)incomplete('Lexical token budget exceeded');
    const frame=stack.at(-1);
    if(frame.kind==='body'){
      if(i>=text.length){if(!frame.root)bad('Unclosed selector body');stack.pop();continue;}
      const c=text[i];
      if(c==="'"){quote(frame.type);continue;}
      if(c==='<'&&/[A-Za-z/]/.test(text[i+1]??''))invalid('unsupported-node','Rich-text tags are unsupported');
      if(c==='}'&&!frame.root){i++;stack.pop();continue;}
      if(c!=='{'){i++;continue;}
      i++;space();const name=identifier();if(!name)bad('Missing argument name');space();
      if(text[i]==='}'){i++;continue;}
      if(text[i++]!==',')bad('Expected argument delimiter');space();const type=identifier();
      if(!['select','plural','selectordinal'].includes(type))invalid('unsupported-node','Only plain placeholders and select/plural/selectordinal are supported');
      space();if(text[i++]!==',')bad('Expected selector comma');space();
      if(type!=='select'&&text.startsWith('offset:',i)){i+=7;space();const n=/^[+-]?[0-9]+/.exec(text.slice(i));if(!n||!Number.isSafeInteger(Number(n[0])))bad('Invalid integer offset');i+=n[0].length;space();}
      const depth=frame.depth+1;if(depth>32)incomplete('Selector nesting limit exceeded');maxDepth=Math.max(maxDepth,depth);
      stack.push({kind:'selector',type,depth,labels:new Set()});
    }else{
      space();if(text[i]==='}'){if(!frame.labels.has('other'))bad('Missing other arm');i++;stack.pop();continue;}
      if(i>=text.length)bad('Unclosed selector');
      let label;
      if(frame.type!=='select'&&text[i]==='='){const m=/^=[+-]?[0-9]+/.exec(text.slice(i));if(!m)bad('Invalid exact label');label=m[0];i+=label.length;if(!/^=(?:0|-?[1-9][0-9]*)$/.test(label)||!Number.isSafeInteger(Number(label.slice(1))))invalid('exact-label','Exact labels must be canonical signed safe integers');}
      else label=identifier();
      if(!label)bad('Missing selector label');
      if(frame.type!=='select'&&!label.startsWith('=')&&!['zero','one','two','few','many','other'].includes(label))invalid('plural-category','Unsupported plural category');
      if(Array.from(label).length>128)invalid('selector-label','Selector label exceeds 128 code points');
      if(frame.labels.has(label))bad('Duplicate selector label');frame.labels.add(label);if(frame.labels.size>1024)incomplete('Selector option limit exceeded');if(++arms>10000)incomplete('Arm limit exceeded');
      space();if(text[i++]!=='{')bad('Expected selector body');stack.push({kind:'body',type:frame.type,depth:frame.depth,root:false});
    }
  }
  return {arms,maxDepth,tokens};
}
