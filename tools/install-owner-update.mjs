/** Install the verified owner-console code bundle into an existing live project.
 * This changes local source files only: no D1 queries, deployment or secret writes.
 * Every overwritten file is backed up first; configuration and data are excluded.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const folder=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2),checkOnly=args.includes('--check');
const live=path.resolve(args.find(x=>x!=='--check')||process.cwd());
const root=path.dirname(live);
const allowed=/^live\/(?:(?:server|frontend|scripts|migrations|test)\/[\w./-]+\.(?:mjs|js|css|sql)|(?:package\.json|README\.md|OWNER-CONSOLE\.md|MAINTENANCE\.md))$/;
const protectedNames=['wrangler.jsonc','.env','.dev.vars'];
const exists=async name=>{try{return await fs.readFile(name)}catch(e){if(e.code==='ENOENT')return null;throw e;}};

async function main(){
 const config=await exists(path.join(live,'wrangler.jsonc'));
 if(!config||!await exists(path.join(live,'package.json'))||!await exists(path.join(live,'server/worker.mjs')))throw Error('Run this installer from the existing live folder, or pass its full path as an argument.');
 const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
 if(manifest.format!=='oria-owner-update-v1'||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Invalid update manifest');
 const seen=new Set(),files=[];
 for(const entry of manifest.files){
  const rel=entry.path;
  if(typeof rel!=='string'||!allowed.test(rel)||rel.split('/').includes('..')||seen.has(rel))throw Error('Unsafe or duplicate update path');
  seen.add(rel);const bytes=await fs.readFile(path.join(folder,'payload',rel));
  if(hash(bytes)!==entry.sha256)throw Error('Update checksum failed: '+rel);
  const destination=path.join(root,rel),before=await exists(destination);
  files.push({rel,bytes,destination,before});
 }
 const worker=files.find(f=>f.rel==='live/server/worker.mjs');
 if(!worker||!worker.bytes.toString().includes("if(path.startsWith('/api/owner/'))"))throw Error('Bundle is missing the owner API router');
 const oldWorker=await fs.readFile(path.join(live,'server/worker.mjs'),'utf8');
 console.log('Project: '+live);
 console.log('Owner API route before install: '+(oldWorker.includes("if(path.startsWith('/api/owner/'))")?'PRESENT':'MISSING'));
 console.log('Files needing replacement: '+files.filter(f=>!f.before||hash(f.before)!==hash(f.bytes)).length);
 if(checkOnly){console.log('Check only: no files modified.');return;}
 const protectedBefore=new Map();for(const name of protectedNames)protectedBefore.set(name,await exists(path.join(live,name)));
 const backup=path.join(live,'.runtime','owner-update-file-backups',new Date().toISOString().replaceAll(/[:.]/g,'-'));
 await fs.mkdir(backup,{recursive:true});
 for(const f of files)if(f.before){const name=path.join(backup,f.rel);await fs.mkdir(path.dirname(name),{recursive:true});await fs.writeFile(name,f.before,{flag:'wx'});}
 const touched=[];
 try{
  for(const f of files){await fs.mkdir(path.dirname(f.destination),{recursive:true});touched.push(f);await fs.writeFile(f.destination,f.bytes);if(hash(await fs.readFile(f.destination))!==hash(f.bytes))throw Error('Installed checksum failed: '+f.rel);}
  for(const [name,before]of protectedBefore){const after=await exists(path.join(live,name));if((before===null)!==(after===null)||(before&&hash(before)!==hash(after)))throw Error('Protected configuration changed: '+name);}
 }catch(e){for(const f of touched.reverse()){if(f.before)await fs.writeFile(f.destination,f.before);else await fs.rm(f.destination,{force:true});}throw e;}
 await fs.writeFile(path.join(backup,'INSTALL-RESULT.json'),JSON.stringify({installedAt:new Date().toISOString(),release:manifest.release,files:manifest.files,ownerRouteInstalled:true,configurationPreserved:true},null,2));
 console.log('Installed and verified '+files.length+' source files.');
 console.log('Configuration, credentials and database data were not changed.');
 console.log('Previous source files: '+backup);
 console.log('Next, run: npm test');
}
main().catch(e=>{console.error('Installation stopped: '+e.message);process.exitCode=1;});
