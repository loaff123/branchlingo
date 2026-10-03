import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp(path.join(tmpdir(),'branchlingo-package-'));
function run(exe,args,cwd=root){const r=spawnSync(exe,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});assert.equal(r.status,0,r.stdout+r.stderr);return r.stdout;}
try{
  const metadata=JSON.parse(run('npm',['pack','--ignore-scripts','--pack-destination',dir,'--json']))[0];
  assert(metadata.files.some(f=>f.path==='src/index.mjs'));assert(metadata.files.some(f=>f.path==='runtime-lock.json'));
  for(const f of metadata.files)assert(/^(?:src\/|bin\/|schemas\/|examples\/|docs\/|package\.json$|runtime-lock\.json$|index\.d\.ts$|README\.md$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/.test(f.path),f.path);
  const consumer=path.join(dir,'consumer');await mkdir(consumer);
  const tarball=path.join(dir,metadata.filename),sourcePackage=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const consumerPackage={name:'isolated-branchlingo-consumer',version:'1.0.0',private:true,type:'module',dependencies:{branchlingo:'file:'+tarball}};
  await writeFile(path.join(consumer,'package.json'),JSON.stringify(consumerPackage));
  // Seed exact public lock metadata, not node_modules: npm ci must materialize every package from tarball/cache.
  const installLock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
  installLock.name=consumerPackage.name;installLock.version='1.0.0';installLock.packages['']={name:consumerPackage.name,version:'1.0.0',dependencies:consumerPackage.dependencies};
  installLock.packages['node_modules/branchlingo']={version:sourcePackage.version,resolved:'file:'+tarball,integrity:metadata.integrity,license:sourcePackage.license,dependencies:sourcePackage.dependencies,bin:sourcePackage.bin,engines:sourcePackage.engines};
  await writeFile(path.join(consumer,'package-lock.json'),JSON.stringify(installLock));
  run('npm',['ci','--offline','--ignore-scripts','--no-audit','--no-fund'],consumer);
  const pkg=path.join(consumer,'node_modules','branchlingo'),cli=path.join(consumer,'node_modules','.bin','branchlingo');
  const sourcePack=path.join(dir,'source-pack.json'),installedReport=path.join(dir,'installed-report.json'),installedPack=path.join(dir,'installed-pack.json');
  run(process.execPath,[path.join(root,'bin/branchlingo.mjs'),'generate',path.join(root,'examples/manifest.json'),'--out',sourcePack]);
  run(cli,['replay',sourcePack,'--manifest',path.join(pkg,'examples/manifest.json'),'--out',installedReport],consumer);
  run(cli,['generate',path.join(pkg,'examples/manifest.json'),'--out',installedPack],consumer);
  assert.equal((await readFile(installedReport,'utf8')).includes('"status":"verified"'),true);
  assert.deepEqual(await readFile(sourcePack),await readFile(installedPack));
  const script=`import {analyzeCatalog,generateCases,replayCases} from 'branchlingo'; import fs from 'node:fs'; const bytes=fs.readFileSync('./node_modules/branchlingo/examples/files.json'); const input={manifestBytes:fs.readFileSync('./node_modules/branchlingo/examples/manifest.json'),catalogsById:new Map(['en','fr','ja'].map(id=>[id,bytes]))};const a=await analyzeCatalog(input);const p=await generateCases(a.analysis);const r=await replayCases({...input,packBytes:Buffer.from(JSON.stringify(p))});if(r.status!=='verified')throw Error(JSON.stringify(r));`;
  run(process.execPath,['--input-type=module','-e',script],consumer);
  run('python3',[path.join(root,'tests/offline_check.py'),pkg],consumer);
  console.log(JSON.stringify({tarball:metadata.filename,files:metadata.files.length,isolatedInstall:'passed',sourceInstalledPacks:'byte-identical',installedApi:'verified',installedOffline:'verified'}));
}finally{await rm(dir,{recursive:true,force:true});}
