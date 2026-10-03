// Real fault-injection test of worker isolation. The production worker is never edited.
// Takes approximately 30 seconds and temporarily exercises the 256 MiB worker heap cap.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'branchlingo-containment-'));
const safety=setTimeout(()=>{console.error('Worker containment test exceeded its 70-second outer deadline');process.exit(1);},70_000);
try {
  await fs.cp(new URL('../src/',import.meta.url),path.join(temporary,'src'),{recursive:true});
  await fs.writeFile(path.join(temporary,'package.json'),'{"type":"module"}');
  const {analyzeCatalog}=await import(pathToFileURL(path.join(temporary,'src/index.mjs')));
  for(const [name,code,expected] of [
    ['heap','const arrays=[];while(true)arrays.push(new Array(100000).fill(12345));','worker-termination'],
    ['watchdog','while(true){}','worker-timeout']
  ]){
    await fs.writeFile(path.join(temporary,'src/worker.mjs'),code);
    const start=performance.now();
    const result=await analyzeCatalog({manifestBytes:Buffer.from('{}'),catalogsById:new Map()});
    const elapsed=performance.now()-start;
    assert.equal(result.status,'incomplete',name);assert.equal(result.diagnostics[0].code,expected,name);
    assert.equal(result.coverageClaim,undefined,name);assert(Object.isFrozen(result));assert(Object.isFrozen(result.diagnostics[0]));
    if(name==='watchdog')assert(elapsed>=29_900,'Watchdog must exercise the real 30-second timeout');
    console.log(JSON.stringify({test:name,status:'passed',milliseconds:Math.round(elapsed),diagnostic:result.diagnostics[0].code}));
  }
} finally {
  clearTimeout(safety);await fs.rm(temporary,{recursive:true,force:true});
}
