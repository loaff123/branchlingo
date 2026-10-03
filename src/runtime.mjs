import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {IntlMessageFormat} from 'intl-messageformat';
import expected from './dependencies.json' with {type:'json'};
import {sha256,canonical} from './codec.mjs';
import {PROFILE} from './input.mjs';
import {invalid} from './errors.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=['src/analyze.mjs','src/codec.mjs','src/dependencies.json','src/engine.mjs','src/errors.mjs','src/files.mjs','src/index.mjs','src/input.mjs','src/preflight.mjs','src/render.mjs','src/runtime.mjs','src/worker.mjs','schemas/bundle.schema.json','bin/branchlingo.mjs','package.json','runtime-lock.json'];
export function assertRuntime(){
  const want={node:'24.19.0',v8:'13.6.233.17-node.51',icu:'78.3',cldr:'48.0',unicode:'17.0'};
  for(const [k,v] of Object.entries(want))if(process.versions[k]!==v)invalid('unsupported-runtime',`This profile requires ${k} ${v}`);
  if(process.platform!=='linux'||process.arch!=='x64')invalid('unsupported-runtime','This profile requires Linux x64');
}
export function runtimeIdentity(){
  assertRuntime();const packages=[];const lockBytes=readFileSync(join(root,'runtime-lock.json'));const lock=JSON.parse(lockBytes);
  const pinnedByName=new Map(expected.map(p=>[p.name,p]));
  const edges=new Map([['intl-messageformat',['@formatjs/fast-memoize','@formatjs/icu-messageformat-parser']],['@formatjs/icu-messageformat-parser',['@formatjs/icu-skeleton-parser']]]);
  const queue=[['@formatjs/icu-messageformat-parser',import.meta.url],['intl-messageformat',import.meta.url]],seen=new Set();
  while(queue.length){const [name,importer]=queue.shift();const p=pinnedByName.get(name);let entry;
    try{const resolver=createRequire(importer);const lookup=resolver.resolve.paths(name)??[];
      const dir=lookup.map(base=>join(base,name)).find(candidate=>existsSync(candidate));
      if(!dir)invalid('dependency-mismatch','Unable to find the controlling package root');
      const metadata=readFileSync(join(dir,'package.json')),meta=JSON.parse(metadata),pinned=lock.packages['node_modules/'+name];
      // Validate the package root that controls exports before trusting require resolution.
      if(sha256(metadata)!==p.packageJsonSha256)invalid('dependency-mismatch','Package exports/metadata differ from the pinned profile');
      entry=resolver.resolve(name);
      if(realpathSync(entry)!==realpathSync(join(dir,'index.js')))invalid('dependency-mismatch','Package entry resolution differs from the pinned profile');
      if(meta.version!==p.version||pinned.version!==p.version||pinned.integrity!==p.integrity||sha256(metadata)!==p.packageJsonSha256||sha256(readFileSync(entry))!==p.entrySha256||sha256(readFileSync(join(dir,'LICENSE.md')))!==p.licenseSha256)invalid('dependency-mismatch','Installed dependency graph does not match the pinned profile');
    }catch(error){if(error.code==='dependency-mismatch')throw error;invalid('dependency-mismatch','Unable to verify the installed dependency graph');}
    if(seen.has(entry))continue;seen.add(entry);
    for(const child of edges.get(name)??[])queue.push([child,entry]);
  }
  for(const p of expected)packages.push({name:p.name,version:p.version,integrity:p.integrity,entrySha256:p.entrySha256});
  return {profile:PROFILE,toolVersion:'0.1.0',toolBuildSha256:sha256(canonical(files.map(p=>[p,sha256(readFileSync(join(root,p)))]))),node:process.versions.node,v8:process.versions.v8,icu:process.versions.icu,cldr:process.versions.cldr,unicode:process.versions.unicode,platform:process.platform,arch:process.arch,lockSha256:sha256(lockBytes),packages};
}
export function localeRuntime(requested,canonicalLocale,behavior){
  const cardinal=new Intl.PluralRules(canonicalLocale,{type:'cardinal'}),ordinal=new Intl.PluralRules(canonicalLocale,{type:'ordinal'}),nf=new Intl.NumberFormat(canonicalLocale);
  const formatter=new IntlMessageFormat('',canonicalLocale).resolvedOptions().locale;
  return {requested,canonical:canonicalLocale,formatterResolved:formatter,pluralCardinalResolved:cardinal.resolvedOptions().locale,pluralOrdinalResolved:ordinal.resolvedOptions().locale,numberResolved:nf.resolvedOptions().locale,behaviorSha256:sha256(canonical({resolved:{formatter,cardinal:cardinal.resolvedOptions(),ordinal:ordinal.resolvedOptions(),number:nf.resolvedOptions()},...behavior}))};
}
