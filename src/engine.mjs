import {buildAnalysis} from './analyze.mjs';
import {renderCase,renderBound} from './render.mjs';
import {strictJSON,canonical,sha256} from './codec.mjs';
import {validatePackShape,checkShape} from './input.mjs';
import {failure,diagnostic,mismatch,incomplete} from './errors.mjs';
function preflightRenders(a){let bytes=0;for(const {scope} of a.cases){scope.renderBound??=renderBound(scope);bytes+=2*scope.renderBound;if(bytes>32*1024*1024)incomplete('Aggregate original render bound exceeds output budget');}}
function verifyCoverage(pack){const all=new Set(pack.cases.flatMap(c=>c.trace));const known=new Set(pack.arms.map(a=>a.id));const cases=new Map(pack.cases.map(c=>[c.id,c]));for(const id of all)if(!known.has(id))mismatch('Unknown trace occurrence');for(const arm of pack.arms){if(arm.classification==='reachable'){if(!all.has(arm.id)||!cases.get(arm.witnessCaseId)?.trace.includes(arm.id))mismatch('A reachable arm is missing its verified witness');}else if(all.has(arm.id))mismatch('An unreachable arm occurred in a formatter trace');}}
export function execute(mode,snapshot){
  if(mode==='replay')return replay(snapshot);
  try{
    const a=buildAnalysis(snapshot);
    if(mode==='analyze')return {status:'analyzed',counts:a.counts,arms:a.basePack.arms,runtime:a.basePack.runtime};
    preflightRenders(a);const pack={...a.basePack,cases:a.cases.map(({scope,spec})=>({...spec,...renderCase(scope,spec,a.budget)}))};verifyCoverage(pack);checkShape(pack,'pack');canonical(pack,{maxBytes:a.limits.packBytes});return pack;
  }catch(error){return failure(error);}
}
function replay(snapshot){
  const report={kind:'branchlingo-replay-report',schemaVersion:1,status:'invalid',packSha256:sha256(snapshot.packBytes),inputMatch:false,runtimeMatch:false,recomputedCounts:null,verifiedCaseIds:[],diagnostics:[]};
  try{
    const pack=validatePackShape(strictJSON(snapshot.packBytes));const a=buildAnalysis(snapshot);
    if(pack.manifestSha256!==a.basePack.manifestSha256||canonical(pack.manifest)!==canonical(a.basePack.manifest)||canonical(pack.sources)!==canonical(a.basePack.sources))mismatch('Pack inputs differ from the separately supplied original bytes');report.inputMatch=true;
    if(canonical(pack.runtime)!==canonical(a.basePack.runtime))mismatch('Pack runtime or package/build identity differs');report.runtimeMatch=true;
    const structure={...pack,cases:pack.cases.map(c=>({id:c.id,catalogId:c.catalogId,messageId:c.messageId,locale:c.locale,arguments:c.arguments}))};
    if(canonical(structure)!==canonical(a.basePack))mismatch('Pack structure, reachability, masks, witnesses, or counts differ from recomputed facts');
    report.recomputedCounts=a.counts;preflightRenders(a);
    for(let i=0;i<a.cases.length;i++){const {scope,spec}=a.cases[i];const rendered=renderCase(scope,spec,a.budget);const claimed=pack.cases[i];if(rendered.output!==claimed.output||rendered.outputSha256!==claimed.outputSha256||canonical(rendered.trace)!==canonical(claimed.trace))mismatch('Rendered output or ordered trace differs');report.verifiedCaseIds.push(spec.id);}
    verifyCoverage(pack);canonical(pack,{maxBytes:a.limits.packBytes});report.status='verified';return report;
  }catch(error){report.status=error.status??'incomplete';report.diagnostics.push(diagnostic(error));return report;}
}
