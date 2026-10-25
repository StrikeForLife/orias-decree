import fs from 'node:fs/promises';
import { seed } from './import-data.mjs';
/** Private SQL for a fresh migrated database; do not serve this file as an asset. */
const statements = [];
const literal = (v) =>
  typeof v === 'number'
    ? String(v)
    : v === null
      ? 'NULL'
      : "'" + String(v).replaceAll("'", "''") + "'";
const collector = {
  prepare(sql) {
    return {
      bind(...args) {
        return { sql, args };
      },
      async first() {
        return null;
      },
    };
  },
  async batch(items) {
    for (const { sql, args } of items) {
      let i = 0;
      const expanded = sql.replaceAll('?', () => literal(args[i++]));
      if (i !== args.length) throw Error('SQL placeholder mismatch');
      statements.push(expanded + ';');
    }
  },
};
await seed(collector);
await fs.mkdir('.runtime', { recursive: true });
await fs.writeFile('.runtime/import.sql', statements.join('\n'));
console.log('Private seed SQL generated for a new database.');
