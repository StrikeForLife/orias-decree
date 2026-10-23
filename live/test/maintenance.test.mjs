import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {rolePlan,contentExport,contentPlan,notePlan,loadBackup,summary} from '../scripts/maintain.mjs';

function fixture(){const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8'));db.exec(`
 INSERT INTO users(id,email,google_sub) VALUES('dm','dm@gmail.com','google-dm'),('p','player@gmail.com','google-p');
 INSERT INTO campaigns(id,name,active) VALUES('camp','Campaign',1);
 INSERT INTO access_grants(id,email,campaign_id,role,user_id,google_sub) VALUES('gdm','dm@gmail.com','camp','dm','dm','google-dm'),('gp','player@gmail.com','camp','player','p','google-p');
 INSERT INTO characters(id,campaign_id,owner_email,owner_user_id,sheet,state) VALUES('char','camp','player@gmail.com','p','{}','{}');
 INSERT INTO sessions VALUES('session','p','csrf',9999999999999);
 INSERT INTO session_notes(id,character_id,author_id,title,date,body) VALUES('note','char','p','Title','2026-10-24','Original');
 `);
 const defs=[['class','class1',{'Class Name (Chinese)':'游俠'}],['school','school1',{Class:'class1','School Name (Chinese)':'詠劍道','Main Spell':'spell1'}],['spell','spell1',{School:'school1','Spell Name (Chinese)':'流風發散','Spell Desc':'old'}]];
 for(const[kind,id,p]of defs)db.prepare('INSERT INTO definitions VALUES(?,?,?)').run(kind,id,JSON.stringify({system_id:id,...p}));return db;}

test('grant is scoped; removal revokes sessions while preserving character and note',()=>{const db=fixture();try{
 const invite=rolePlan(db,'new@gmail.com','player','camp');db.exec(invite.sql);
 assert.equal(db.prepare("SELECT user_id FROM access_grants WHERE email='new@gmail.com'").get().user_id,null);
 db.exec(rolePlan(db,'player@gmail.com','reader','camp').sql);
 assert.equal(db.prepare("SELECT count(*) n FROM sessions WHERE user_id='p'").get().n,0);
 assert.equal(db.prepare('SELECT count(*) n FROM characters').get().n,1);assert.equal(db.prepare('SELECT count(*) n FROM session_notes').get().n,1);
 assert.equal(db.prepare("SELECT count(*) n FROM access_grants WHERE email='player@gmail.com'").get().n,0);
}finally{db.close();}});

test('last DM and stale role plans fail before changing grants',()=>{const db=fixture();try{
 assert.throws(()=>rolePlan(db,'dm@gmail.com','reader','camp'),/last DM/);
 const p=rolePlan(db,'player@gmail.com','dm','camp');db.exec("UPDATE access_grants SET role='dm' WHERE id='gp'");
 assert.throws(()=>db.exec(p.sql),/CHECK/);assert.equal(db.prepare("SELECT role FROM access_grants WHERE id='gdm'").get().role,'dm');
}finally{db.close();}});

test('pending DM cannot replace the last claimed DM',()=>{const db=fixture();try{
 db.exec("INSERT INTO access_grants(id,email,campaign_id,role) VALUES('pending','pending@gmail.com','camp','dm')");
 assert.throws(()=>rolePlan(db,'dm@gmail.com','player','camp'),/claimed DM/);
}finally{db.close();}});

test('content preserves quotes/newlines and does not overwrite concurrent edits',()=>{const db=fixture();try{
 const doc=contentExport(db);doc.items.find(x=>x.kind==='spell').payload['Spell Desc']="Orian's text\n中文與 ' 引號";
 const plan=contentPlan(db,doc);db.exec(plan.sql);
 assert.equal(JSON.parse(db.prepare("SELECT payload FROM definitions WHERE kind='spell'").get().payload)['Spell Desc'],"Orian's text\n中文與 ' 引號");
 assert.throws(()=>db.exec(plan.sql),/CHECK/);
}finally{db.close();}});

test('content rejects omissions, invalid references, duplicate IDs and structural rewrites',()=>{const db=fixture();try{
 const d=contentExport(db);assert.throws(()=>contentPlan(db,{...d,items:d.items.slice(1)}),/Deleting/);
 const p=structuredClone(d);p.items.find(x=>x.kind==='spell').payload.School='missing';assert.throws(()=>contentPlan(db,p),/reference|school/);
 assert.throws(()=>contentPlan(db,{...d,items:[...d.items,d.items[0]]}),/Duplicate/);
 const s=structuredClone(d);s.items.find(x=>x.kind==='school').payload['Main Spell']='';assert.throws(()=>contentPlan(db,s),/migration/);
 const a=structuredClone(d);a.items.push({kind:'spell',id:'newspell',payload:{system_id:'newspell',School:'school1','Spell Name (Chinese)':'新法術'}});db.exec(contentPlan(db,a).sql);
 assert.equal(db.prepare("SELECT count(*) n FROM definitions WHERE id='newspell'").get().n,1);
}finally{db.close();}});

test('note recovery only restores selected note with CAS and current ownership',()=>{const db=fixture(),old=fixture();try{
 db.exec("UPDATE session_notes SET body='mistake',deleted=1,version=2 WHERE id='note'");
 db.exec(notePlan(db,old,'note').sql);assert.deepEqual({...db.prepare("SELECT body,deleted,version,author_id FROM session_notes WHERE id='note'").get()},{body:'Original',deleted:0,version:3,author_id:'p'});
 const plan=notePlan(db,old,'note');db.exec("UPDATE session_notes SET body='newer',version=4 WHERE id='note'");assert.throws(()=>db.exec(plan.sql),/CHECK/);
 db.exec("UPDATE session_notes SET author_id='dm' WHERE id='note'");assert.throws(()=>notePlan(db,old,'note'),/ownership/);
}finally{db.close();old.close();}});

test('backup verifier performs import, schema and foreign key checks',()=>{const folder=fs.mkdtempSync(path.join(os.tmpdir(),'oria-maint-'));try{
 const schema=fs.readFileSync(new URL('../migrations/0001.sql',import.meta.url),'utf8');const file=path.join(folder,'backup.sql');fs.writeFileSync(file,schema);const db=loadBackup(file);assert.equal(summary(db).characters,0);db.close();
 fs.writeFileSync(file,"CREATE TABLE unrelated(id TEXT);");assert.throws(()=>loadBackup(file),/no such table/);
 fs.writeFileSync(file,schema.replace('PRAGMA foreign_keys=ON;','PRAGMA foreign_keys=OFF;')+"INSERT INTO session_notes(id,character_id,author_id,title,date,body) VALUES('broken','missing','missing','','','');");assert.throws(()=>loadBackup(file),/Foreign-key/);
}finally{fs.rmSync(folder,{recursive:true});}});
