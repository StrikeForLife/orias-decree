import {migrateLocal} from './migrate-local.mjs';
import {mkdir} from 'node:fs/promises';import {sqliteDB} from './sqlite-adapter.mjs';import {seed} from './import-data.mjs';
await mkdir('.runtime',{recursive:true});const db=sqliteDB(process.env.ORIA_DB_PATH||'.runtime/oria.sqlite');migrateLocal(db);console.log(await seed(db));db.close();
