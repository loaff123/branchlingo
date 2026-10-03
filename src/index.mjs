import {Worker} from 'node:worker_threads';
import {deepFreeze} from './codec.mjs';
import {BranchLingoError,failure,invalid,incomplete} from './errors.mjs';
const handles=new WeakMap();
function snapshotInput(input,withPack=false){
  if(!input||typeof input!=='object')invalid('input-type','Expected input byte records');
  function copy(b,cap){if(!(b instanceof Uint8Array)||b.buffer instanceof SharedArrayBuffer)invalid('input-type','Expected non-shared Uint8Array input');if(b.byteLength>cap)incomplete('Input byte limit exceeded');return new Uint8Array(b);}
  const manifestBytes=copy(input.manifestBytes,2*1024*1024);const catalogsById=new Map();if(!(input.catalogsById instanceof Map))invalid('input-type','Expected a Map of explicit catalog bytes');if(input.catalogsById.size>16)incomplete('Catalog count limit exceeded');let total=manifestBytes.length;
  for(const [id,b] of input.catalogsById){if(typeof id!=='string')invalid('input-type','Catalog IDs must be strings');if(!(b instanceof Uint8Array))invalid('input-type','Catalogs must contain Uint8Array bytes');total+=b.byteLength;if(total>2*1024*1024)incomplete('Aggregate source byte limit exceeded');catalogsById.set(id,copy(b,2*1024*1024));}
  return {manifestBytes,catalogsById,...(withPack?{packBytes:copy(input.packBytes,16*1024*1024)}:{})};
}
function runWorker(mode,snapshot){return new Promise(resolve=>{
  let done=false,worker;
  const finish=result=>{if(done)return;done=true;clearTimeout(timer);resolve(deepFreeze(result));void worker?.terminate();};
  const timer=setTimeout(()=>finish(failure(new BranchLingoError('incomplete','worker-timeout','Worker exceeded its 30 second execution watchdog'))),30_000);
  try{worker=new Worker(new URL('./worker.mjs',import.meta.url),{workerData:{mode,snapshot},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:16,stackSizeMb:4},execArgv:[]});worker.once('message',finish);worker.once('error',()=>finish(failure(new BranchLingoError('incomplete','worker-termination','Bounded worker terminated'))));worker.once('exit',()=>finish(failure(new BranchLingoError('incomplete','worker-termination','Bounded worker exited before returning a result'))));}
  catch{finish(failure(new BranchLingoError('incomplete','worker-start','Unable to start bounded worker')));}
});}
export async function analyzeCatalog(input){
  let snapshot;try{snapshot=snapshotInput(input);}catch(error){return deepFreeze(failure(error));}
  const result=await runWorker('analyze',snapshot);if(result.status!=='analyzed')return result;
  const analysis=Object.freeze(Object.create(null));handles.set(analysis,snapshot);return deepFreeze({...result,analysis});
}
export async function generateCases(analysis){if(!analysis||typeof analysis!=='object'||!handles.has(analysis))return deepFreeze(failure(new BranchLingoError('invalid','analysis-handle','Expected a current-process analysis handle')));return runWorker('generate',handles.get(analysis));}
export async function replayCases(input){let snapshot;try{snapshot=snapshotInput(input,true);}catch(error){return deepFreeze(failure(error));}return runWorker('replay',snapshot);}
