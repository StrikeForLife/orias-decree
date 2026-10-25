import { DatabaseSync } from 'node:sqlite';
/** D1-compatible adapter for local development and the exact same endpoint tests. */
export function sqliteDB(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON;');
  class Statement {
    constructor(sql, args = []) {
      this.sql = sql;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.sql, args);
    }
    async first() {
      return db.prepare(this.sql).get(...this.args) || null;
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.args) };
    }
    async run() {
      const r = db.prepare(this.sql).run(...this.args);
      return { meta: { changes: Number(r.changes) } };
    }
  }
  return {
    raw: db,
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = [];
        for (const statement of statements) {
          const r = db.prepare(statement.sql).run(...statement.args);
          result.push({ meta: { changes: Number(r.changes) } });
        }
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  };
}
