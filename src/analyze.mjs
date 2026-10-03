import {parse} from '@formatjs/icu-messageformat-parser';
import {validateInputs,PROFILE} from './input.mjs';
import {preflightMF1,PARSER_OPTIONS} from './preflight.mjs';
import {canonical,sha256} from './codec.mjs';
import {assertRuntime,runtimeIdentity,localeRuntime} from './runtime.mjs';
import {invalid,incomplete} from './errors.mjs';
const cats=new Set(['zero','one','two','few','many','other']);
const byName=(a,b)=>a.name<b.name?-1:a.name>b.name?1:0;
const hash=v=>sha256(canonical(v));
const position=p=>({offsetUtf16:p.offset,line:p.line,columnCodePoints:p.column});
const span=p=>({start:position(p.start),end:position(p.end)});
const fullMask=size=>{const a=new Uint32Array(Math.ceil(size/32));a.fill(0xffffffff);if(size%32)a[a.length-1]=0xffffffff>>>(32-size%32);return a;};
function intersection(a,b){const words=new Uint32Array(a.length);let count=0,first=-1;for(let i=0;i<a.length;i++){let n=(a[i]&b[i])>>>0;words[i]=n;if(n&&first<0)first=i*32+31-Math.clz32((n&-n)>>>0);while(n){count++;n=(n&(n-1))>>>0;}}return {words,count,first};}
function walkScope(scope,totals,usage){
  preflightMF1(scope.text);
  try{scope.ast=parse(scope.text,PARSER_OPTIONS);}catch{invalid('mf1-syntax','The pinned parser rejected the message',{catalogId:scope.catalogId,messageId:scope.messageId});}
  scope.nodes=0;scope.arms=[];scope.selectors=[];scope.nodeSelectors=new Map();
  const stack=scope.ast.slice().reverse().map(node=>({node,ancestors:[],depth:0}));
  while(stack.length){const task=stack.pop();
    if(task.arm){scope.arms.push(task.arm);continue;}
    const {node,ancestors,depth}=task;scope.nodes++;totals.astNodes++;if(totals.astNodes>totals.limits.astNodes)incomplete('Aggregate AST node limit exceeded');
    if(![0,1,5,6,7].includes(node.type))invalid('unsupported-node','Unsupported AST element');
    if(node.type===0||node.type===7)continue;
    if(Array.from(node.value).length>128)invalid('argument-name','Argument name exceeds 128 code points');
    const binding=scope.contract.bindings.get(node.value);if(!binding)invalid('contract','Missing argument binding',{catalogId:scope.catalogId,messageId:scope.messageId});
    const used=usage.get(scope.messageId);used.add(node.value);
    if(node.type===1)continue;
    if(depth>=32)incomplete('Selector nesting limit exceeded');
    if(node.type===5&&binding.domain.kind!=='string-enum'||node.type===6&&binding.domain.kind!=='integer-range')invalid('selector-domain','Selector type does not match its domain');
    if(node.type===6){if(!Number.isSafeInteger(node.offset))invalid('offset','Invalid offset');for(const n of [binding.domain.min,binding.domain.max]){const result=BigInt(n)-BigInt(node.offset);if(result<BigInt(Number.MIN_SAFE_INTEGER)||result>BigInt(Number.MAX_SAFE_INTEGER))invalid('offset','Offset subtraction exceeds safe integer range');}}
    const options=Object.entries(node.options).sort((a,b)=>a[1].location.start.offset-b[1].location.start.offset);
    if(options.length>1024)incomplete('Selector option limit exceeded');if(!Object.hasOwn(node.options,'other'))invalid('other-arm','Missing other arm');
    const selector={node,binding,options:[],depth:depth+1};scope.selectors.push(selector);scope.nodeSelectors.set(node,selector);
    for(const [label,option] of options){if(node.type===6&&!cats.has(label)&&(!/^=(?:0|-?[1-9][0-9]*)$/.test(label)||!Number.isSafeInteger(Number(label.slice(1)))))invalid('exact-label','Noncanonical exact label or unknown plural category');
      const id=hash([PROFILE,scope.catalogId,scope.sourceHash,scope.messageId,scope.locale,node.location.start.offset,option.location.start.offset,label]);
      const arm={id,node,selector,option,label,ancestors,depth:depth+1};selector.options.push(arm);totals.arms++;if(totals.arms>totals.limits.arms)incomplete('Aggregate arm limit exceeded');
    }
    for(let j=selector.options.length-1;j>=0;j--){const arm=selector.options[j];const path=[...ancestors,arm];for(let k=arm.option.value.length-1;k>=0;k--)stack.push({node:arm.option.value[k],ancestors:path,depth:depth+1});stack.push({arm});}
  }
}
export function buildAnalysis(snapshot){
  assertRuntime();const input=validateInputs(snapshot);const {scopes,contracts,limits}=input;
  const totals={astNodes:0,arms:0,limits};const usage=new Map([...contracts].map(([id])=>[id,new Set()]));
  for(const scope of scopes)walkScope(scope,totals,usage);
  for(const [id,c] of contracts)if(c.variables.some(v=>!usage.get(id).has(v.name)))invalid('contract','Unused argument binding');
  let dispatch=0n,wordOps=0n,witnessUpper=0n,renderUpper=0n,memory=BigInt(input.rawBytes)*6n+BigInt(totals.astNodes)*320n+BigInt(input.domainSum)*32n;
  for(const scope of scopes){const upper=scope.arms.length||1;witnessUpper+=BigInt(upper);renderUpper+=BigInt(2*scope.nodes+scope.arms.length)*BigInt(upper);
    memory+=BigInt(upper)*BigInt(256+scope.contract.variables.length*96);
    for(const selector of scope.selectors){const size=BigInt(selector.binding.size),words=(size+31n)/32n;dispatch+=size;wordOps+=size+2n*words*BigInt(selector.options.length);memory+=words*4n*BigInt(selector.options.length)+BigInt(selector.options.length)*BigInt(768+selector.depth*192);}
  }
  for(const [name,total] of [['dispatchEvaluations',dispatch],['maskWordOps',wordOps],['witnessCases',witnessUpper],['renderWork',renderUpper]])if(total>BigInt(limits[name]))incomplete(`${name} preflight limit exceeded`);
  memory+=dispatch*80n;
  if(memory>64n*1024n*1024n)incomplete('Controlled allocation estimate exceeds 64 MiB');
  for(const c of contracts.values())for(const b of c.bindings.values()){const d=b.domain;b.values=d.kind==='integer-range'?Array.from({length:b.size},(_,i)=>d.min+i):d.kind==='string-enum'?d.values.slice():[d.value];b.full={words:fullMask(b.size),count:b.size,first:0};}
  const behavior=new Map();const rules=new Map();const numberFormats=new Map();
  for(const ref of input.manifest.catalogs){const scope=scopes.find(s=>s.catalogId===ref.id);if(!behavior.has(scope.locale)){behavior.set(scope.locale,{dispatch:[],numbers:new Map()});numberFormats.set(scope.locale,new Intl.NumberFormat(scope.locale));for(const n of [0,1,2,3,11,21,1000])behavior.get(scope.locale).numbers.set(n,numberFormats.get(scope.locale).format(n));}}
  for(const scope of scopes){const behaviorItem=behavior.get(scope.locale);
    for(const selector of scope.selectors){const {node,binding,options}=selector;const masks=new Map(options.map(a=>[a.label,new Uint32Array(Math.ceil(binding.size/32))]));const sequence=[];
      let rule;if(node.type===6){const key=scope.locale+':'+node.pluralType;if(!rules.has(key))rules.set(key,new Intl.PluralRules(scope.locale,{type:node.pluralType}));rule=rules.get(key);}
      for(let i=0;i<binding.values.length;i++){const v=binding.values[i];let label;if(node.type===5)label=Object.hasOwn(node.options,v)?v:'other';else{const exact='='+v;const adjusted=v-node.offset;const category=rule.select(adjusted);label=Object.hasOwn(node.options,exact)?exact:Object.hasOwn(node.options,category)?category:'other';if(!behaviorItem.numbers.has(adjusted))behaviorItem.numbers.set(adjusted,numberFormats.get(scope.locale).format(adjusted));}masks.get(label)[i>>>5]|=1<<(i&31);sequence.push(label);}
      behaviorItem.dispatch.push([scope.catalogId,scope.messageId,node.location.start.offset,sequence]);
      for(const arm of options){arm.mask=masks.get(arm.label);arm.local=intersection(binding.full.words,arm.mask);arm.maskHash=hash([binding.domain.kind,binding.values,Array.from(arm.mask)]);}
    }
  }
  const packArms=[],cases=[];let renderWork=0;
  for(const scope of scopes){const state=new Map([...scope.contract.bindings].map(([name,b])=>[name,b.full]));const caseMap=new Map();scope.caseMap=caseMap;
    function witness(){const args=[...scope.contract.bindings].map(([name,b])=>({name,value:b.values[state.get(name).first]})).sort(byName);const id=hash([PROFILE,scope.catalogId,scope.sourceHash,scope.messageId,scope.locale,args]);if(!caseMap.has(id)){const c={id,catalogId:scope.catalogId,messageId:scope.messageId,locale:scope.locale,arguments:args};caseMap.set(id,c);cases.push({scope,spec:c});renderWork+=2*scope.nodes+scope.arms.length;}return id;}
    const stack=[];for(let i=scope.ast.length-1;i>=0;i--)stack.push({node:scope.ast[i],ancestors:[]});
    while(stack.length){const t=stack.pop();if(t.restore){state.set(t.name,t.restore);continue;}
      if(t.arm){const a=t.arm,name=a.node.value,previous=state.get(name),next=intersection(previous.words,a.mask);state.set(name,next);
        const chain=[...t.ancestors,a];const emptyVariables=[...state].filter(([,v])=>!v.count).map(([k])=>k).sort();const reachable=!emptyVariables.length;
        packArms.push({id:a.id,catalogId:scope.catalogId,messageId:scope.messageId,locale:scope.locale,variable:name,selectorType:a.node.type===5?'select':a.node.pluralType==='ordinal'?'selectordinal':'plural',label:a.label,selectorSpan:span(a.node.location),bodySpan:span(a.option.location),localAllowedCount:a.local.count,constraints:chain.map(x=>({ancestorArmId:x.id,variable:x.node.value,allowedCount:x.local.count,maskSha256:x.maskHash})),classification:reachable?'reachable':'unreachable',witnessCaseId:reachable?witness():null,emptyVariables});
        stack.push({name,restore:previous});for(let j=a.option.value.length-1;j>=0;j--)stack.push({node:a.option.value[j],ancestors:chain});
      }else if(t.node.type===5||t.node.type===6){const s=scope.nodeSelectors.get(t.node);for(let j=s.options.length-1;j>=0;j--)stack.push({arm:s.options[j],ancestors:t.ancestors});}
    }
    if(!scope.arms.length)witness();
    scope.numberStrings=behavior.get(scope.locale).numbers;
  }
  const runtime={...runtimeIdentity(),locales:input.manifest.catalogs.map(ref=>{const scope=scopes.find(s=>s.catalogId===ref.id);const b=behavior.get(scope.locale);return localeRuntime(ref.locale,scope.locale,{dispatch:b.dispatch,numbers:[...b.numbers].sort((a,b)=>a[0]-b[0])});})};
  const reachable=packArms.filter(a=>a.classification==='reachable').length;
  const counts={messages:scopes.length,arms:packArms.length,reachable,unreachable:packArms.length-reachable,cases:cases.length,dispatchEvaluations:Number(dispatch),maskWordOps:Number(wordOps),renderWork};
  const basePack={kind:'branchlingo-exercise-pack',schemaVersion:1,status:'complete',coverageClaim:'every-reachable-arm-in-declared-finite-cartesian-domains',manifestSha256:input.manifestSha256,manifest:input.manifest,sources:input.sources,runtime,counts,arms:packArms,cases:cases.map(c=>c.spec)};
  return {basePack,scopes,cases,counts,limits,budget:{renderWork:0,outputBytes:0,maxRenderWork:limits.renderWork},estimates:{controlledBytes:Number(memory),witnessUpper:Number(witnessUpper),renderUpper:Number(renderUpper)}};
}
