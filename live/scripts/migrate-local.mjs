import fs from 'node:fs';
/** Local migrations mirror production order, without touching source imports. */
export function migrateLocal(db){
 db.raw.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
 if(db.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='campaigns'").get())db.raw.prepare('INSERT OR IGNORE INTO local_migrations VALUES(?)').run('0001.sql');
 const folder=new URL('../migrations/',import.meta.url);
 for(const name of fs.readdirSync(folder).filter(x=>x.endsWith('.sql')).sort()){
  if(db.raw.prepare('SELECT 1 FROM local_migrations WHERE name=?').get(name))continue;
  db.raw.exec('BEGIN');try{db.raw.exec(fs.readFileSync(new URL(name,folder),'utf8'));db.raw.prepare('INSERT INTO local_migrations VALUES(?)').run(name);db.raw.exec('COMMIT');}catch(e){db.raw.exec('ROLLBACK');throw e;}
 }
}
