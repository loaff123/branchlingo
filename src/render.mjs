import {IntlMessageFormat} from 'intl-messageformat';
import {PARSER_OPTIONS} from './preflight.mjs';
import {sha256} from './codec.mjs';
import {incomplete,mismatch} from './errors.mjs';
const P='\ue000',Q='\ue001',R='\ue002';
export function markerPrefix(text){let longest=0,run=0;for(const ch of text){if(ch===P){run++;longest=Math.max(longest,run);}else run=0;}return P.repeat(longest+1)+Q;}
export function extractMarkers(marked,prefix,known){const parts=[],trace=[];let i=0;for(;;){const start=marked.indexOf(prefix,i);if(start<0){parts.push(marked.slice(i));break;}parts.push(marked.slice(i,start));const id=marked.slice(start+prefix.length,start+prefix.length+64);if(marked[start+prefix.length+64]!==R||!known.has(id))mismatch('Unknown or malformed trace marker');trace.push(id);i=start+prefix.length+65;}return {output:parts.join(''),trace};}
function valueBytes(binding){if(binding.maxBytes===undefined){let max=0;for(const v of binding.values)max=Math.max(max,Buffer.byteLength(String(v)));binding.maxBytes=max;}return binding.maxBytes;}
export function renderBound(scope){
  function body(nodes,plural){let length=0;for(const node of nodes){if(node.type===0)length+=Buffer.byteLength(node.value);else if(node.type===1)length+=valueBytes(scope.contract.bindings.get(node.value));else if(node.type===7){if(plural)length+=plural.poundBound;}
      else {const selector=scope.nodeSelectors.get(node);if(node.type===6&&selector.poundBound===undefined){let max=0;for(const value of selector.binding.values)max=Math.max(max,Buffer.byteLength(scope.numberStrings.get(value-node.offset)));selector.poundBound=max;}let max=0;for(const option of selector.options)max=Math.max(max,body(option.option.value,node.type===6?selector:null));length+=max;}
      if(length>1024*1024)incomplete('Original render size bound exceeds 1 MiB');
    }return length;}
  return body(scope.ast,null);
}
function instrument(scope,prefix){
  function clone(nodes){return nodes.map(node=>{if(node.type!==5&&node.type!==6)return {...node};const result={...node,options:Object.create(null)};for(const arm of scope.nodeSelectors.get(node).options)result.options[arm.label]={...arm.option,value:[{type:0,value:prefix+arm.id+R},...clone(arm.option.value)]};return result;});}
  return clone(scope.ast);
}
export function renderCase(scope,spec,budget){
  const work=2*scope.nodes+scope.arms.length;budget.renderWork+=work;if(budget.renderWork>budget.maxRenderWork)incomplete('Run render work limit exceeded');
  const bound=scope.renderBound??=renderBound(scope);if(budget.outputBytes+2*bound>32*1024*1024)incomplete('Aggregate render byte bound exceeded');
  const args=Object.create(null);for(const a of spec.arguments)args[a.name]=a.value;
  let output;try{output=new IntlMessageFormat(scope.text,scope.locale,undefined,PARSER_OPTIONS).format(args);}catch{mismatch('Original formatter failed');}
  if(typeof output!=='string')mismatch('Formatter output was not text');const outputBytes=Buffer.byteLength(output);if(outputBytes>bound||outputBytes>1024*1024)mismatch('Original formatter exceeded validated output bound');
  // Compute the required run length before constructing any repeated marker string.
  let longest=0,run=0;for(const ch of output){if(ch===P){run++;longest=Math.max(longest,run);}else run=0;}
  const markerBytes=3*(longest+1)+3+64+3;
  const markedBound=bound+markerBytes*scope.arms.length;
  if(markedBound>2*1024*1024||budget.outputBytes+outputBytes+markedBound>32*1024*1024)incomplete('Instrumented output size bound exceeded');
  const prefix=P.repeat(longest+1)+Q;const ast=instrument(scope,prefix);let marked;
  try{marked=new IntlMessageFormat(ast,scope.locale,undefined,PARSER_OPTIONS).format(args);}catch{mismatch('Instrumented formatter failed');}
  if(typeof marked!=='string'||Buffer.byteLength(marked)>markedBound)mismatch('Marked formatter exceeded validated output bound');
  budget.outputBytes+=outputBytes+Buffer.byteLength(marked);const recovered=extractMarkers(marked,prefix,new Set(scope.arms.map(a=>a.id)));
  if(recovered.output!==output)mismatch('Trace marker removal did not restore original output');
  return {output,outputSha256:sha256(output),trace:recovered.trace};
}
