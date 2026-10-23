import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {sqliteDB} from '../scripts/sqlite-adapter.mjs';
import {createHandler} from '../server/worker.mjs';
import {hash} from '../server/auth.mjs';
import {claimSiteOwner,selectionGuard} from '../server/owner-admin.mjs';
import {migrateLocal} from '../scripts/migrate-local.mjs';

const schema=(await fs.readFile(new URL('../migrations/0001.sql',import.meta.url),'utf8'))+(await fs.readFile(new URL('../migrations/0002_owner_console.sql',import.meta.url),'utf8'));
async function fixture(){
 const db=sqliteDB();db.raw.exec(schema);db.raw.exec("INSERT INTO campaigns(id,name,active) VALUES('camp','Campaign',1),('othercamp','Other',0)");
 for(const [id,role]of [['keeper','player'],['dm','dm'],['player','player'],['reader',null]]){
  db.raw.prepare('INSERT INTO users(id,google_sub,email,name) VALUES(?,?,?,?)').run(id,'google-'+id,id+'@gmail.com',id);
  if(role)db.raw.prepare('INSERT INTO access_grants(id,email,google_sub,user_id,campaign_id,role) VALUES(?,?,?,?,?,?)').run('grant-'+id,id+'@gmail.com','google-'+id,id,'camp',role);
  db.raw.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await hash(Buffer.from(id).toString('hex').padEnd(64,'a')),id,'csrf-'+id,Date.now()+100000);
 }
 db.raw.exec("INSERT INTO site_owner VALUES(1,'keeper',1)");
 const defs=[['class','ranger',{'Class Name (Chinese)':'游俠','Level 8 Perk':'hidden future'}],['school','wind',{'School Name (Chinese)':'風道',Class:'ranger','Main Spell':'core'}],['spell','core',{'Spell Name (Chinese)':'核心',School:'wind','Spell Desc':'original'}],['spell','unused',{'Spell Name (Chinese)':'未使用',School:'wind','Spell Desc':'draft'}],['weapon','blade',{'Weapon Name':'劍'}]];
 for(const [kind,id,p]of defs)db.raw.prepare('INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)').run(kind,id,JSON.stringify({system_id:id,...p}));
 db.raw.prepare('INSERT INTO characters(id,campaign_id,owner_email,owner_user_id,sheet,state) VALUES(?,?,?,?,?,?)').run('hero','camp','player@gmail.com','player',JSON.stringify({'Character Name':'Hero',Class:'ranger',School:'wind',Level:1}),JSON.stringify({hp:15,temp:0,will:1,wounds:[],general:'private'}));
 db.raw.exec("INSERT INTO character_spells VALUES('hero','core'); INSERT INTO session_notes(id,character_id,author_id,title,date,body) VALUES('note','hero','player','Session','2026-10-24','private note')");
 const env={DB:db,APP_ORIGIN:'https://oria.example',GOOGLE_CLIENT_ID:'client',ASSETS:{fetch:()=>new Response('asset')}};
 const handler=createHandler();
 const call=(actor,path,body,extra={})=>handler(new Request(env.APP_ORIGIN+path,{method:body===undefined?'GET':'POST',headers:{Origin:env.APP_ORIGIN,Cookie:'__Host-oria_session='+Buffer.from(actor).toString('hex').padEnd(64,'a'),'X-CSRF-Token':'csrf-'+actor,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
 return {db,env,call,handler};
}
const json=async r=>({status:r.status,body:await r.json()});

test('only the bound website owner can read or write console; DM and spoofed headers fail',async()=>{
 const {db,call}=await fixture();try{
  for(const actor of ['dm','player','reader']){assert.equal((await call(actor,'/api/owner/bootstrap')).status,403);assert.equal((await call(actor,'/api/owner/member',{email:'x@gmail.com',role:'dm',campaignId:'camp',id:null,version:null},{'X-Owner':'keeper','oai-authenticated-user-email':'keeper@gmail.com'})).status,403);}
  const b=await json(await call('keeper','/api/owner/bootstrap'));assert.equal(b.status,200);assert.equal(b.body.catalog.length,5);assert(!JSON.stringify(b.body).includes('private note'));
  const owner=await(await call('keeper','/api/bootstrap')).json();assert.equal(owner.isOwner,true);assert.equal(owner.isDM,false);
  assert.equal((await(await call('dm','/api/bootstrap')).json()).isOwner,false);
 }finally{db.close();}
});
test('owner mutation still requires matching Origin and CSRF',async()=>{const {db,call}=await fixture();try{
 const body={kind:'weapon',id:'blade',version:0,payload:{system_id:'blade','Weapon Name':'新劍'}};
 assert.equal((await call('keeper','/api/owner/content',body,{'X-CSRF-Token':'wrong'})).status,403);
 assert.equal((await call('keeper','/api/owner/content',body,{Origin:'https://evil.example'})).status,403);
}finally{db.close();}});

test('content CRUD is audited, versioned and soft-deleted; archived content stays out of player data',async()=>{const {db,call}=await fixture();try{
 const add={kind:'weapon',id:'new-blade',version:null,payload:{system_id:'new-blade','Weapon Name':'<script> & new sword','Effect':"Quoted ' text\n第二行"}};
 assert.equal((await call('keeper','/api/owner/content',add)).status,201);
 const edit={...add,version:0,payload:{...add.payload,Effect:'updated'}};assert.equal((await call('keeper','/api/owner/content',edit)).status,200);assert.equal((await call('keeper','/api/owner/content',edit)).status,409);
 assert.equal((await call('keeper','/api/owner/content/archive',{kind:add.kind,id:add.id,version:1,archived:true})).status,200);
 const player=await(await call('reader','/api/bootstrap')).json();assert(!player.data.weapon.some(x=>x.system_id===add.id));
 assert.equal((await call('keeper','/api/owner/content/archive',{kind:add.kind,id:add.id,version:2,archived:false})).status,200);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_audit').get().n,4);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_checks').get().n,0);
}finally{db.close();}});

test('cannot delete referenced content or move an in-use spell to another school',async()=>{const {db,call}=await fixture();try{
 for(const[kind,id]of [['class','ranger'],['school','wind'],['spell','core']])assert.equal((await call('keeper','/api/owner/content/archive',{kind,id,version:0,archived:true})).status,409);
 const old=JSON.parse(db.raw.prepare("SELECT payload FROM definitions WHERE id='core'").get().payload);
 assert.equal((await call('keeper','/api/owner/content',{kind:'spell',id:'core',version:0,payload:{...old,School:'missing'}})).status,400);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_audit').get().n,0);
}finally{db.close();}});

test('guarded selection aborts atomically if definition was archived after validation',async()=>{const {db}=await fixture();try{
 const g=selectionGuard(db,[['spell','unused']]);db.raw.exec("UPDATE definitions SET archived=1 WHERE id='unused'");
 await assert.rejects(db.batch([g.statement,db.prepare("UPDATE characters SET version=99 WHERE id='hero'"),g.cleanup]),/CHECK/);
 assert.equal(db.raw.prepare("SELECT version FROM characters WHERE id='hero'").get().version,0);
}finally{db.close();}});

test('role removal revokes sessions immediately, preserves private data and rejects last DM removal',async()=>{const {db,call}=await fixture();try{
 assert.equal((await call('keeper','/api/owner/member',{email:'dm@gmail.com',role:'reader',campaignId:'camp',id:'grant-dm',version:0})).status,409);
 assert.equal((await call('keeper','/api/owner/member',{email:'player@gmail.com',role:'reader',campaignId:'camp',id:'grant-player',version:0})).status,200);
 assert.equal((await call('player','/api/bootstrap')).status,401);
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM characters').get().n,1);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM session_notes').get().n,1);
 assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM access_grants WHERE email='player@gmail.com'").get().n,0);
}finally{db.close();}});

test('membership create/update uses scoped optimistic locking and does not pre-claim Google accounts',async()=>{const {db,call}=await fixture();try{
 const invite={email:'new@gmail.com',role:'player',campaignId:'camp',id:null,version:null};assert.equal((await call('keeper','/api/owner/member',invite)).status,200);
 const row=db.raw.prepare("SELECT * FROM access_grants WHERE email='new@gmail.com'").get();assert.equal(row.user_id,null);assert.equal(row.google_sub,null);
 assert.equal((await call('keeper','/api/owner/member',invite)).status,409);
 assert.equal((await call('keeper','/api/owner/member',{...invite,id:row.id,version:0,role:'dm'})).status,200);
 assert.equal((await call('keeper','/api/owner/member',{...invite,id:row.id,version:0,role:'reader'})).status,409);
}finally{db.close();}});

test('owner claim requires verified authoritative matching email and cannot replace established owner',async()=>{const {db}=await fixture();try{
 db.raw.exec('DELETE FROM site_owner');const user={id:'keeper'},claims={email:'keeper@gmail.com',email_verified:true};
 await claimSiteOwner(db,user,{...claims,email_verified:false},claims.email);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM site_owner').get().n,0);
 await claimSiteOwner(db,user,claims,'other@gmail.com');assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM site_owner').get().n,0);
 await claimSiteOwner(db,user,{email:'keeper@example.com',email_verified:true},'keeper@example.com');assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM site_owner').get().n,0);
 await claimSiteOwner(db,user,claims,' KEEPER@gmail.com ');assert.equal(db.raw.prepare('SELECT user_id FROM site_owner').get().user_id,'keeper');
 await claimSiteOwner(db,{id:'dm'},{email:'dm@gmail.com',email_verified:true},'dm@gmail.com');assert.equal(db.raw.prepare('SELECT user_id FROM site_owner').get().user_id,'keeper');
}finally{db.close();}});

test('new campaign stays inactive and owner receives a bound DM grant; stale edits fail',async()=>{const {db,call}=await fixture();try{
 const body={id:'new-camp',version:null,name:'新戰役',name_en:'New campaign',intro:'Story'};assert.equal((await call('keeper','/api/owner/campaign',body)).status,200);
 assert.equal(db.raw.prepare("SELECT active FROM campaigns WHERE id='new-camp'").get().active,0);
 assert.equal(db.raw.prepare("SELECT user_id FROM access_grants WHERE campaign_id='new-camp'").get().user_id,'keeper');
 assert.equal((await call('keeper','/api/owner/campaign',body)).status,409);
}finally{db.close();}});

test('external CLI payload changes are detected even without a version increment',async()=>{const {db,call}=await fixture();try{
 // Simulate a change between the owner's read and the transactional guard.
 const original=db.batch.bind(db);db.batch=async statements=>{db.raw.exec(`UPDATE definitions SET payload='{"system_id":"blade","Weapon Name":"Concurrent"}' WHERE id='blade'`);return original(statements);};
 assert.equal((await call('keeper','/api/owner/content',{kind:'weapon',id:'blade',version:0,payload:{system_id:'blade','Weapon Name':'Stale'}})).status,409);
 assert.equal(JSON.parse(db.raw.prepare("SELECT payload FROM definitions WHERE id='blade'").get().payload)['Weapon Name'],'Concurrent');
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_audit').get().n,0);
}finally{db.close();}});

test('owner schema upgrade preserves existing characters, notes, sessions and import triggers',async()=>{
 const db=sqliteDB();try{
  db.raw.exec(await fs.readFile(new URL('../migrations/0001.sql',import.meta.url),'utf8'));
  db.raw.exec("INSERT INTO users(id,email) VALUES('u','test@example.invalid'); INSERT INTO campaigns(id,name) VALUES('c','Campaign'); INSERT INTO characters(id,campaign_id,owner_email,sheet,state) VALUES('h','c','test@example.invalid','{}','{}'); INSERT INTO session_notes(id,character_id,author_id,title,date,body) VALUES('n','h','u','Title','2026-10-24','Keep me'); INSERT INTO sessions VALUES('token','u','csrf',9999999999999); CREATE TRIGGER oria_imported_notes_claim_v1 AFTER UPDATE OF owner_user_id ON characters BEGIN SELECT 1; END;");
  migrateLocal(db);migrateLocal(db);
  assert.equal(db.raw.prepare("SELECT body FROM session_notes WHERE id='n'").get().body,'Keep me');
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM sessions').get().n,1);
  assert.equal(db.raw.prepare("SELECT version FROM characters WHERE id='h'").get().version,0);
  assert(db.raw.prepare("SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='oria_imported_notes_claim_v1'").get());
  assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
