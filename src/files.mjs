import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {strictJSON} from './codec.mjs';
import {checkShape,safeRelativePath} from './input.mjs';
import {BranchLingoError,invalid,incomplete} from './errors.mjs';
function localPath(p){if(typeof p!=='string'||!p||p.includes('\0')||/^[a-z][a-z0-9+.-]*:/i.test(p))invalid('local-path','Expected an explicitly named local file path');return path.resolve(p);}
async function noSymlinks(file,allowMissingLeaf=false){const parsed=path.parse(file);let current=parsed.root;const parts=file.slice(parsed.root.length).split(path.sep).filter(Boolean);for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);let st;try{st=await fs.lstat(current);}catch(e){if(e.code==='ENOENT'&&allowMissingLeaf&&i===parts.length-1)return;throw e;}if(st.isSymbolicLink())invalid('symlink','Symlink components are not accepted');if(i<parts.length-1&&!st.isDirectory())invalid('local-path','Parent component must be a directory');}}
export async function readRegular(filename,cap){
  const absolute=localPath(filename);await noSymlinks(absolute);const before=await fs.lstat(absolute);if(!before.isFile())invalid('regular-file','Input must be a regular file');if(before.size>cap)incomplete('Input file byte limit exceeded');
  const handle=await fs.open(absolute,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const st=await handle.stat();if(!st.isFile()||st.dev!==before.dev||st.ino!==before.ino)invalid('file-race','Input changed while opening');if(st.size>cap)incomplete('Input file byte limit exceeded');
    const data=Buffer.alloc(Math.min(cap+1,st.size+1));let offset=0;while(offset<data.length){const {bytesRead}=await handle.read(data,offset,data.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}
    if(offset>cap)incomplete('Input file byte limit exceeded');const after=await handle.stat();const named=await fs.lstat(absolute);await noSymlinks(absolute);
    if(after.size!==offset||after.size!==st.size||after.mtimeMs!==st.mtimeMs||after.ctimeMs!==st.ctimeMs||named.dev!==st.dev||named.ino!==st.ino||named.isSymbolicLink())invalid('file-race','Input changed during its bounded read');
    return {bytes:new Uint8Array(data.subarray(0,offset)),identity:{path:absolute,dev:st.dev,ino:st.ino}};
  }finally{await handle.close();}
}
export async function readInputs(manifestPath){const m=await readRegular(manifestPath,2*1024*1024);const manifest=checkShape(strictJSON(m.bytes,{maxBytes:2*1024*1024}),'manifest');const root=path.dirname(m.identity.path),catalogsById=new Map(),cache=new Map(),inputIdentities=[m.identity];let total=m.bytes.length;
  for(const ref of manifest.catalogs){safeRelativePath(ref.path);const full=path.resolve(root,ref.path);if(!full.startsWith(root+path.sep))invalid('catalog-path','Catalog must remain inside the manifest directory');let value=cache.get(full);if(!value){value=await readRegular(full,2*1024*1024);cache.set(full,value);inputIdentities.push(value.identity);}total+=value.bytes.length;if(total>2*1024*1024)incomplete('Aggregate source byte limit exceeded');if(catalogsById.has(ref.id))invalid('duplicate-id','Duplicate catalog ID');catalogsById.set(ref.id,value.bytes);}
  return {manifestBytes:m.bytes,catalogsById,inputIdentities};
}
export async function installOutput(filename,bytes,inputIdentities=[]){
  if(!(bytes instanceof Uint8Array)||bytes.length>16*1024*1024)incomplete('Output byte limit exceeded');const absolute=localPath(filename);await noSymlinks(absolute,true);
  if(inputIdentities.some(x=>x.path===absolute))invalid('input-alias','Output cannot overwrite an input');
  try{const st=await fs.lstat(absolute);if(inputIdentities.some(x=>x.dev===st.dev&&x.ino===st.ino))invalid('input-alias','Output aliases an input');throw new BranchLingoError('invalid','output-exists','Output already exists; choose a new explicit path');}catch(e){if(e.code!=='ENOENT')throw e;}
  const dir=path.dirname(absolute);const temporary=path.join(dir,'.branchlingo-'+randomBytes(16).toString('hex')+'.tmp');let handle;
  try{handle=await fs.open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await noSymlinks(absolute,true);
    // link() is atomic create-if-absent. Unlike rename(), it cannot clobber a racing writer.
    await fs.link(temporary,absolute);
  }finally{if(handle)await handle.close();await fs.unlink(temporary).catch(()=>{});}
  // File bytes were synced before installation. Directory sync is best-effort, not a portable crash guarantee.
  let directory;try{directory=await fs.open(dir,constants.O_RDONLY);await directory.sync();}catch{}finally{await directory?.close();}
}
