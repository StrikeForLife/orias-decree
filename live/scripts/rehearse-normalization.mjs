import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { sqliteDB } from './sqlite-adapter.mjs';
import { createHandler } from '../server/worker.mjs';

const folder = new URL('../migrations/', import.meta.url);
const coreMigration = fs.readFileSync(new URL('0003_normalize_core.sql', folder), 'utf8');
const oldMigrations = ['0001.sql', '0002_owner_console.sql'];
export const legacySchema = oldMigrations
  .map((n) => fs.readFileSync(new URL(n, folder), 'utf8'))
  .join('\n');

function tableSnapshot(db) {
  return Object.fromEntries(
    db.raw
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map(({ name }) => [
        name,
        db.raw.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all(),
      ]),
  );
}

/** No network or remote D1 binding. A trusted SQL export runs only in memory.
 * Values and response bodies are compared in memory and never printed.
 */
export function migrateAndCompare(db) {
  const before = tableSnapshot(db);
  const originalSchema = db.raw
    .prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")
    .all();
  db.raw.exec('BEGIN IMMEDIATE');
  try {
    db.raw.exec(coreMigration);
    for (const [table, rows] of Object.entries(before))
      assert.deepEqual(
        db.raw.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}" ORDER BY rowid`).all(),
        rows,
        `Original table changed: ${table}`,
      );
    for (const entry of originalSchema)
      assert.deepEqual(
        db.raw
          .prepare('SELECT type,name,sql FROM sqlite_schema WHERE name=? AND type=?')
          .get(entry.name, entry.type),
        entry,
        'Original schema changed',
      );
    let documents = 0;
    for (const table of ['characters', 'definitions']) {
      for (const row of before[table]) {
        const current = db.raw
          .prepare(
            `SELECT * FROM normalized_${table} WHERE id=?${table === 'definitions' ? ' AND kind=?' : ''}`,
          )
          .get(...(table === 'definitions' ? [row.id, row.kind] : [row.id]));
        assert(current, `Missing normalized ${table} row`);
        for (const column of table === 'characters' ? ['sheet', 'state'] : ['payload']) {
          assert.deepEqual(
            JSON.parse(current[column]),
            JSON.parse(row[column]),
            `Document mismatch: ${table}.${column}`,
          );
          documents++;
        }
      }
    }
    assert.equal(db.raw.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
    const report = {
      originalTables: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.length])),
      documentsCompared: documents,
      issues: db.raw
        .prepare(
          'SELECT reason,COUNT(*) AS count FROM normalization_issues GROUP BY reason ORDER BY reason',
        )
        .all()
        .map((x) => ({ ...x })),
    };
    db.raw.exec('COMMIT');
    return report;
  } catch (e) {
    db.raw.exec('ROLLBACK');
    throw e;
  }
}

/** Current APIs may require later additive migrations. Apply them only in the
 * isolated copy, verifying every pre-existing column and record stays intact. */
export function applyFollowupMigrations(db) {
  const names = fs
    .readdirSync(folder)
    .filter((name) => name.endsWith('.sql') && name > '0003_normalize_core.sql')
    .sort();
  const before = tableSnapshot(db),
    columns = {};
  for (const name of Object.keys(before))
    columns[name] = db.raw
      .prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`)
      .all()
      .map((c) => '"' + c.name.replaceAll('"', '""') + '"')
      .join(',');
  db.raw.exec('BEGIN IMMEDIATE');
  try {
    for (const name of names) db.raw.exec(fs.readFileSync(new URL(name, folder), 'utf8'));
    for (const [name, rows] of Object.entries(before))
      assert.deepEqual(
        db.raw
          .prepare(`SELECT ${columns[name]} FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`)
          .all(),
        rows,
        'Followup changed original records',
      );
    db.raw.exec('COMMIT');
  } catch (e) {
    db.raw.exec('ROLLBACK');
    throw e;
  }
  return names;
}

/** Exercise the same protected endpoints with legacy storage vs normalized
 * storage. This adapter changes only SELECT source names, never auth or writes.
 */
export function legacyReads(db) {
  return {
    ...db,
    prepare(sql) {
      return db.prepare(
        sql
          .replaceAll('normalized_characters', 'characters')
          .replaceAll('normalized_definitions', 'definitions'),
      );
    },
  };
}

export async function compareBootstrapAPIs(
  db,
  baselineHandler = createHandler(),
  { allowAddedInfo = false } = {},
) {
  const handler = createHandler();
  const current = {
    DB: db,
    APP_ORIGIN: 'https://normalization.invalid',
    GOOGLE_CLIENT_ID: 'rehearsal',
    ASSETS: { fetch: () => new Response('asset') },
  };
  const before = { ...current, DB: legacyReads(db) };
  let responses = 0;
  // A token hash and CSRF are private; use an isolated transaction and synthetic
  // probe sessions, then roll back. No real session token is needed or exposed.
  const { hash } = await import('../server/auth.mjs');
  db.raw.exec('BEGIN IMMEDIATE');
  try {
    for (const user of db.raw.prepare('SELECT id FROM users ORDER BY id').all()) {
      const token = await hash(crypto.randomUUID());
      db.raw
        .prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)')
        .run(await hash(token), user.id, 'rehearsal', Date.now() + 60000);
      for (const endpoint of ['/api/bootstrap', '/api/owner/bootstrap']) {
        const req = () =>
          new Request(current.APP_ORIGIN + endpoint, {
            headers: { Cookie: '__Host-oria_session=' + token },
          });
        const a = await baselineHandler(req(), before),
          b = await handler(req(), current);
        const expected =
          endpoint === '/api/bootstrap' ||
          db.raw.prepare('SELECT 1 FROM site_owner WHERE user_id=?').get(user.id)
            ? 200
            : 403;
        assert.equal(a.status, expected, 'Legacy API authentication or probe failed');
        assert.equal(b.status, expected, 'Normalized API authentication or probe failed');
        assert.equal(b.status, a.status, 'API status mismatch');
        const actual = await b.json(),
          expectedBody = await a.json();
        if (allowAddedInfo) {
          if (actual.data && !Object.hasOwn(expectedBody.data || {}, 'info'))
            delete actual.data.info;
          if (
            actual.catalog &&
            expectedBody.catalog &&
            !expectedBody.catalog.some((x) => x.kind === 'info')
          )
            actual.catalog = actual.catalog.filter((x) => x.kind !== 'info');
        }
        assert.deepEqual(actual, expectedBody, 'API body mismatch');
        responses++;
      }
    }
  } finally {
    db.raw.exec('ROLLBACK');
  }
  return responses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input || ![3, 4].includes(process.argv.length))
    throw Error(
      'Usage: node live/scripts/rehearse-normalization.mjs <trusted-private-backup.sql> [previous-worker.mjs]',
    );
  const db = sqliteDB();
  try {
    db.raw.exec(fs.readFileSync(path.resolve(input), 'utf8'));
    const report = migrateAndCompare(db);
    report.followupMigrations = applyFollowupMigrations(db);
    const baseline = process.argv[3]
      ? await import(pathToFileURL(path.resolve(process.argv[3])).href)
      : null;
    report.bootstrapResponsesCompared = await compareBootstrapAPIs(db, baseline?.createHandler(), {
      allowAddedInfo:
        !!baseline && report.followupMigrations.includes('0004_campaign_controls.sql'),
    });
    report.expectedApiAdditions =
      baseline && report.followupMigrations.includes('0004_campaign_controls.sql')
        ? ['data.info', 'owner.catalog:info']
        : [];
    report.apiBaseline = baseline ? 'previous-worker' : 'legacy-storage';
    report.acceptance = report.issues.length ? 'REVIEW_REQUIRED' : 'READY_FOR_OWNER_VALIDATION';
    console.log(JSON.stringify(report, null, 2));
    if (report.issues.length) process.exitCode = 2;
  } catch {
    console.error(
      'Rehearsal failed: original schema/data and normalized documents or API results do not match. The source file was not modified; inspect the isolated copy privately.',
    );
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
