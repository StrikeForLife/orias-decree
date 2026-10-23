import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const live=fileURLToPath(new URL('..',import.meta.url));
const kinds=['class','school','spell','weapon','beliefs','background'];
const quote=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
const stamp=()=>new Date().toISOString().replaceAll(/[:.]/g,'-');
const fail=message=>{throw new Error(message)};
const digest=x=>createHash('sha256').update(x).digest('hex');

/** Restore a full SQL export into memory, without executing it against production. */
export function loadBackup(file){
 const sql=fs.readFileSync(file,'utf8'),db=new DatabaseSync(':memory:');
 try{db.exec(sql);const integrity=db.prepare('PRAGMA integrity_check').all();
  if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')fail('SQLite integrity check failed');
  if(db.prepare('PRAGMA foreign_key_check').all().length)fail('Foreign-key check failed');
  for(const table of ['users','campaigns','access_grants','characters','definitions','session_notes','sessions','operations'])db.prepare(`SELECT COUNT(*) FROM ${table}`).get();
  return db;
 }catch(e){db.close();throw e;}
}
export function summary(db){return Object.fromEntries(['campaigns','characters','definitions','session_notes','access_grants'].map(t=>[t,Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n)]));}

/** A CHECK failure stops a stale or unsafe plan before its first data update.
 * Execute a whole generated file in one Wrangler call during a maintenance window.
 * No BEGIN/COMMIT: D1 manages the import transaction.
 */
function guarded(conditions,statements){
 const id=randomUUID();
 return `-- Generated maintenance plan. Review first; use a fresh verified backup.\nCREATE TABLE IF NOT EXISTS oria_maintenance_checks(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));\nINSERT INTO oria_maintenance_checks(id,ok) SELECT ${quote(id)},CASE WHEN (${conditions.join(') AND (')||'1'}) THEN 1 ELSE 0 END;\n${statements.join(';\n')};\nDELETE FROM oria_maintenance_checks WHERE id=${quote(id)};\n`;
}

/** Player removal means reader access, as specified for unlisted Google accounts.
 * Never deletes characters, notes, identities, or the final DM grant.
 */
export function rolePlan(db,email,role,campaign){
 email=email.trim().toLowerCase();
 if(!/^[^\s@'";]+@[^\s@'";]+\.[^\s@'";]+$/.test(email))fail('Invalid email');
 if(!['dm','player','reader'].includes(role))fail('Role must be dm, player or reader');
 const camp=db.prepare('SELECT * FROM campaigns WHERE id=?').get(campaign);if(!camp)fail('Unknown campaign ID');
 const old=db.prepare('SELECT * FROM access_grants WHERE email=? AND campaign_id=?').get(email,campaign);
 if((old?.role||'reader')===role)fail('No role change needed');
 const where=`email=${quote(email)} AND campaign_id=${quote(campaign)}`;
 const conditions=[`EXISTS(SELECT 1 FROM campaigns WHERE id=${quote(campaign)})`];
 if(old){
  conditions.push(`EXISTS(SELECT 1 FROM access_grants WHERE ${where} AND id=${quote(old.id)} AND role=${quote(old.role)} AND user_id IS ${quote(old.user_id)} AND google_sub IS ${quote(old.google_sub)})`);
 }else conditions.push(`NOT EXISTS(SELECT 1 FROM access_grants WHERE ${where})`);
 if(old?.role==='dm'&&role!=='dm'){
  if(db.prepare("SELECT COUNT(*) AS n FROM access_grants WHERE campaign_id=? AND role='dm'").get(campaign).n<=1)fail('Cannot remove or demote the last DM');
  if(old.user_id&&!db.prepare("SELECT 1 FROM access_grants WHERE campaign_id=? AND role='dm' AND id<>? AND user_id IS NOT NULL AND google_sub IS NOT NULL").get(campaign,old.id))fail('Keep another claimed DM before demoting this account');
  conditions.push(`(SELECT COUNT(*) FROM access_grants WHERE campaign_id=${quote(campaign)} AND role='dm')>1`);
  if(old.user_id)conditions.push(`EXISTS(SELECT 1 FROM access_grants WHERE campaign_id=${quote(campaign)} AND role='dm' AND id<>${quote(old.id)} AND user_id IS NOT NULL AND google_sub IS NOT NULL)`);
 }
 const statements=[];
 if(role==='reader')statements.push(`DELETE FROM access_grants WHERE ${where}`);
 else if(old)statements.push(`UPDATE access_grants SET role=${quote(role)} WHERE ${where}`);
 else statements.push(`INSERT INTO access_grants(id,email,campaign_id,role) VALUES(${quote(randomUUID())},${quote(email)},${quote(campaign)},${quote(role)})`);
 // Invalidate sessions across campaigns, without changing identity bindings.
 const userIds=db.prepare('SELECT id FROM users WHERE lower(email)=? UNION SELECT user_id AS id FROM access_grants WHERE email=? AND user_id IS NOT NULL').all(email,email).map(x=>x.id);
 if(userIds.length)statements.push(`DELETE FROM sessions WHERE user_id IN (${userIds.map(quote).join(',')})`);
 return {description:`${camp.name}: ${email}: ${old?.role||'reader'} -> ${role}. Characters/notes retained. Sign in again afterwards.`,sql:guarded(conditions,statements)};
}

export function contentExport(db){return {format:'oria-content-v1',instructions:'Edit payload fields; preserve kind/id/system_id. Duplicate an entry with a NEW stable ID to add content. Do not delete existing entries.',items:db.prepare('SELECT kind,id,payload FROM definitions ORDER BY kind,id').all().map(r=>({...r,payload:JSON.parse(r.payload)}))};}

/** Optimistic comparison against the export snapshot prevents stale editor writes.
 * Rules/relationship migrations require code review; descriptive content is safe here.
 */
export function contentPlan(db,doc){
 if(doc.format!=='oria-content-v1'||!Array.isArray(doc.items))fail('Invalid content document');
 const current=db.prepare('SELECT * FROM definitions').all(),before=new Map(current.map(x=>[x.kind+':'+x.id,x])),after=new Map();
 for(const item of doc.items){
  if(!kinds.includes(item.kind)||!/^[-\w]{1,100}$/.test(item.id)||!item.payload||Array.isArray(item.payload)||typeof item.payload!=='object'||item.payload.system_id!==item.id)fail('Invalid kind/id/payload/system_id');
  const key=item.kind+':'+item.id;if(after.has(key))fail('Duplicate content ID: '+key);after.set(key,item);
 }
 for(const key of before.keys())if(!after.has(key))fail('Deleting entries is unsupported; missing '+key);
 const conditions=[],statements=[],changes=[];
 const names={class:'Class Name (Chinese)',school:'School Name (Chinese)',spell:'Spell Name (Chinese)',weapon:'Weapon Name',beliefs:'Name',background:'Background Name (Chinese)'};
 const exists=(kind,id)=>!id||after.has(kind+':'+id);
 for(const [key,item]of after){
  const old=before.get(key),p=item.payload,next=JSON.stringify(p);
  if(old&&JSON.stringify(JSON.parse(old.payload))===next)continue;
  if(Object.values(p).some(x=>typeof x!=='string'&&typeof x!=='number'&&typeof x!=='boolean'&&x!==null))fail('Nested payload values unsupported: '+key);
  if(names[item.kind]&&item.kind!=='background'&&!String(p[names[item.kind]]||'').trim())fail('Missing name: '+key);
  if(item.kind==='school'){
   if(!p.Class||!exists('class',p.Class)||!exists('beliefs',p.Belief)||!exists('spell',p['Main Spell']))fail('Invalid school reference: '+key);
   if(p['Main Spell']&&after.get('spell:'+p['Main Spell']).payload.School!==item.id)fail('Core spell must belong to this school');
  }
  if(item.kind==='spell'&&(!p.School||!exists('school',p.School)))fail('Invalid spell school: '+key);
  if(old){const prev=JSON.parse(old.payload);for(const field of ['Class','School','Belief','Main Spell','delete_flag'])if((prev[field]||'')!==(p[field]||''))fail('Relationship/deletion changes need a separate migration: '+key+' / '+field);
   conditions.push(`EXISTS(SELECT 1 FROM definitions WHERE kind=${quote(item.kind)} AND id=${quote(item.id)} AND payload=${quote(old.payload)})`);
   statements.push(`UPDATE definitions SET payload=${quote(next)} WHERE kind=${quote(item.kind)} AND id=${quote(item.id)}`);
  }else{
   conditions.push(`NOT EXISTS(SELECT 1 FROM definitions WHERE kind=${quote(item.kind)} AND id=${quote(item.id)})`);
   statements.push(`INSERT INTO definitions(kind,id,payload) VALUES(${quote(item.kind)},${quote(item.id)},${quote(next)})`);
  }
  changes.push(`${old?'UPDATE':'ADD'} ${key}: ${p[names[item.kind]]||p.Name||item.id}`);
 }
 if(!changes.length)fail('No content changes detected');
 return {description:changes.join('\n'),sql:guarded(conditions,statements)};
}

/** Recover one note, keeping current ownership and leaving other notes untouched. */
export function notePlan(current,older,id){
 const now=current.prepare('SELECT * FROM session_notes WHERE id=?').get(id),old=older.prepare('SELECT * FROM session_notes WHERE id=?').get(id);
 if(!now||!old||now.character_id!==old.character_id||now.author_id!==old.author_id)fail('Note missing or ownership changed; manual recovery review required');
 const condition=`EXISTS(SELECT 1 FROM session_notes WHERE id=${quote(id)} AND character_id=${quote(now.character_id)} AND author_id=${quote(now.author_id)} AND version=${Number(now.version)} AND deleted=${Number(now.deleted)} AND body=${quote(now.body)} AND title=${quote(now.title)} AND date=${quote(now.date)})`;
 return {description:`Recover note ${id} to ${old.date} / ${old.title}; other records unchanged.`,sql:guarded([condition],[`UPDATE session_notes SET title=${quote(old.title)},date=${quote(old.date)},body=${quote(old.body)},deleted=0,version=version+1 WHERE id=${quote(id)}`])};
}

/** Invoke npm's official npx JS entrypoint without a shell (Windows safe too). */
function wrangler(args){
 const bin=path.dirname(fs.realpathSync(process.execPath));
 const candidates=[process.env.npm_execpath&&path.join(path.dirname(process.env.npm_execpath),'npx-cli.js'),path.join(bin,'node_modules/npm/bin/npx-cli.js'),path.resolve(bin,'../lib/node_modules/npm/bin/npx-cli.js'),'/usr/share/nodejs/npm/bin/npx-cli.js'];
 const cli=candidates.find(p=>p&&fs.existsSync(p));if(!cli)fail('Cannot locate npx. Run this script using: npm exec -- node scripts/maintain.mjs ...');
 const r=spawnSync(process.execPath,[cli,'--yes','wrangler@4',...args],{cwd:live,encoding:'utf8',maxBuffer:32*1024*1024,shell:false});
 if(r.status!==0)fail(r.stderr||r.stdout||r.error?.message||'Wrangler failed');return r.stdout;
}
function config(){const c=JSON.parse(fs.readFileSync(path.join(live,'wrangler.jsonc'),'utf8'));if(c.d1_databases?.[0]?.database_name!=='oria-decree'||!/^[\da-f-]{36}$/.test(c.d1_databases[0].database_id))fail('Configure the real D1 database ID in wrangler.jsonc first');return c;}
function emit(plan,backup){const folder=path.join(live,'.runtime/maintenance');fs.mkdirSync(folder,{recursive:true});const name=path.join(folder,`plan-${stamp()}.sql`);fs.writeFileSync(name,plan.sql,{flag:'wx'});fs.writeFileSync(name+'.json',JSON.stringify({createdAt:new Date().toISOString(),backup:path.resolve(backup),backupSha256:digest(fs.readFileSync(backup)),description:plan.description},null,2));console.log(plan.description+'\n\nSaved plan: '+name+'\nReview the SQL, then apply from live:\nnpx wrangler@4 d1 execute oria-decree --remote --file "'+name+'"');}

export function main(argv){
 const [command,...args]=argv;
 if(command==='backup'){
  const c=config(),folder=path.join(live,'.runtime/backups',stamp());fs.mkdirSync(folder,{recursive:true});const file=path.join(folder,'database.sql');
  console.log(wrangler(['d1','export','oria-decree','--remote','--output',file]));
  const db=loadBackup(file),counts=summary(db);db.close();
  const bookmark=wrangler(['d1','time-travel','info','oria-decree']);fs.writeFileSync(path.join(folder,'bookmark.txt'),bookmark);
  fs.copyFileSync(path.join(live,'wrangler.jsonc'),path.join(folder,'wrangler.jsonc'));
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),timezone:'UTC',databaseId:c.d1_databases[0].database_id,origin:c.vars.APP_ORIGIN,sha256:digest(fs.readFileSync(file)),counts,verified:'SQLite import + integrity_check + foreign_key_check. Cloudflare restore drill still required.',bookmarkNote:'Recorded AFTER export; not the exact export snapshot.'},null,2));
  console.log('Verified backup: '+file+'\n'+JSON.stringify(counts)+'\nCopy the complete folder to your private backup storage.');return;
 }
 if(command==='verify'){
  const db=loadBackup(args[0]);console.log(summary(db));db.close();
  const manifest=path.join(path.dirname(path.resolve(args[0])),'manifest.json');if(fs.existsSync(manifest)){const m=JSON.parse(fs.readFileSync(manifest));if(m.sha256!==digest(fs.readFileSync(args[0])))fail('Backup hash mismatch');console.log('SHA-256 matched');}return;
 }
 if(command==='help'||!command){console.log('Run from live (Node 24):\nbackup\nverify <database.sql>\nmembers <database.sql>\nrole <database.sql> <email> <player|dm|reader> <campaign-id>\ncontent-export <database.sql> <output.json>\ncontent-plan <same-database.sql> <edited.json>\nnotes <database.sql>\nnote-recover <current.sql> <older.sql> <note-id>\n\nOnly backup contacts Cloudflare (read/export). Other commands inspect trusted SQL exports locally or generate a reviewable plan.');return;}
 const db=loadBackup(args[0]);
 try{
  if(command==='members'){
   console.table(db.prepare('SELECT id,name,active FROM campaigns').all());console.table(db.prepare('SELECT campaign_id,email,role,user_id IS NOT NULL AS claimed FROM access_grants ORDER BY campaign_id,role,email').all());
  }else if(command==='role')emit(rolePlan(db,args[1],args[2],args[3]),args[0]);
  else if(command==='content-export'){fs.writeFileSync(args[1],JSON.stringify(contentExport(db),null,2),{flag:'wx'});console.log('Created '+args[1]);}
  else if(command==='content-plan')emit(contentPlan(db,JSON.parse(fs.readFileSync(args[1]))),args[0]);
  else if(command==='notes')console.table(db.prepare(`SELECT n.id,json_extract(c.sheet,'$."Character Name"') AS character,n.date,n.title,n.deleted FROM session_notes n JOIN characters c ON c.id=n.character_id ORDER BY n.date`).all());
  else if(command==='note-recover'){const old=loadBackup(args[1]);try{emit(notePlan(db,old,args[2]),args[0]);}finally{old.close();}}
  else fail('Unknown command; run help');
 }finally{db.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main(process.argv.slice(2));}catch(e){console.error('Maintenance stopped: '+e.message);process.exitCode=1;}}
