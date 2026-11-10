import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sqliteDB } from '../scripts/sqlite-adapter.mjs';
import { migrateLocal } from '../scripts/migrate-local.mjs';
import { normalizationSQL } from '../scripts/generate-normalization.mjs';
import { documents } from '../scripts/normalization-schema.mjs';
import {
  legacySchema,
  migrateAndCompare,
  applyFollowupMigrations,
  compareBootstrapAPIs as compareCoreAPIs,
  legacyReads,
} from '../scripts/rehearse-normalization.mjs';
import { createHandler } from '../server/worker.mjs';
import { hash } from '../server/auth.mjs';
import { normalizationFixture as fixture } from './fixtures/normalization-fixture.mjs';

const migration = fs.readFileSync(
  new URL('../migrations/0003_normalize_core.sql', import.meta.url),
  'utf8',
);

// The core 0003 checks remain unchanged; current Worker APIs also need the
// additive feature schema before exercising legacy-vs-normalized reads.
async function compareBootstrapAPIs(db, ...args) {
  if (!db.raw.prepare("SELECT 1 FROM sqlite_schema WHERE name='archive_info'").get())
    applyFollowupMigrations(db);
  return compareCoreAPIs(db, ...args);
}

test('checked-in D1 migration matches the field mapping generator', () =>
  assert.equal(migration, normalizationSQL()));

test('isolated migration preserves every original row, document, ID and API response for all roles', async () => {
  const db = fixture();
  try {
    const report = migrateAndCompare(db);
    assert.equal(report.documentsCompared, 11);
    assert.equal(await compareBootstrapAPIs(db), 8);
    assert(report.issues.some((x) => x.reason === 'unknown_field'));
    assert(report.issues.some((x) => x.reason === 'unresolved_reference'));
    assert.equal(
      db.raw.prepare("SELECT max_hp FROM character_profiles WHERE id='hero'").get().max_hp,
      '123',
    );
    assert.equal(db.raw.prepare("SELECT hp FROM character_resources WHERE id='hero'").get().hp, -7);
    assert.deepEqual(
      db.raw
        .prepare("SELECT amount FROM character_wounds WHERE character_id='hero' ORDER BY ordinal")
        .all()
        .map((x) => x.amount),
      [2, 2, 1],
    );
    assert.deepEqual(
      db.raw
        .prepare(
          "SELECT belief_id FROM character_beliefs WHERE character_id='hero' ORDER BY ordinal",
        )
        .all()
        .map((x) => x.belief_id),
      ['faith', 'faith', 'missing-faith'],
    );
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM class_perks').get().n, 8);
    assert(
      db.raw
        .prepare(
          "SELECT 1 FROM definition_links WHERE source_kind='school' AND field='Main Spell' AND target_id='core'",
        )
        .get(),
    );
    assert(
      db.raw
        .prepare(
          "SELECT 1 FROM normalization_issues WHERE field='Spells' AND reason='unresolved_reference'",
        )
        .get(),
    );
    assert(db.raw.prepare("SELECT 1 FROM sqlite_schema WHERE name='imported_claim'").get());
    // The initial rollback image remains immutable across later compatibility writes.
    const old = db.raw
      .prepare("SELECT state FROM normalization_legacy_characters WHERE id='hero'")
      .get().state;
    db.raw.prepare("UPDATE characters SET state=?,version=version+1 WHERE id='hero'").run(
      JSON.stringify({
        hp: -11,
        temp: 0,
        will: 0,
        wounds: [4, 4],
        inventory: 'free text',
        newField: [1],
      }),
    );
    assert.equal(
      db.raw.prepare("SELECT state FROM normalization_legacy_characters WHERE id='hero'").get()
        .state,
      old,
    );
    assert.deepEqual(
      JSON.parse(
        db.raw.prepare("SELECT state FROM normalized_characters WHERE id='hero'").get().state,
      ),
      { hp: -11, temp: 0, will: 0, wounds: [4, 4], inventory: 'free text', newField: [1] },
    );
    assert.equal(await compareBootstrapAPIs(db), 8);
  } finally {
    db.close();
  }
});

test('all mapped fields preserve missing, null, bool, string, number and unexpected structured values', () => {
  for (const value of [
    null,
    false,
    true,
    '',
    0,
    -12,
    1.25,
    '001',
    [],
    { nested: ['value', null] },
  ]) {
    const db = sqliteDB();
    try {
      db.raw.exec(legacySchema);
      db.raw.exec("INSERT INTO campaigns(id,name) VALUES('c','Campaign')");
      for (const d of documents.filter((x) => x.kind)) {
        const payload = Object.fromEntries(Object.keys(d.fields).map((k) => [k, value]));
        if (d.children) for (const key of Object.keys(d.children)) payload[key] = value;
        payload['unknown.key"'] = value;
        db.raw
          .prepare('INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)')
          .run(d.kind, d.kind, JSON.stringify(payload));
      }
      const sh = Object.fromEntries(Object.keys(documents[0].fields).map((k) => [k, value]));
      sh._baseStats = value;
      sh._growth = value;
      const st = {
        hp: value,
        temp: value,
        will: value,
        general: value,
        inventory: value,
        wounds: Array.isArray(value) ? [value, value] : value,
      };
      db.raw
        .prepare('INSERT INTO characters(id,campaign_id,owner_email,sheet,state) VALUES(?,?,?,?,?)')
        .run('h', 'c', 'u@example.invalid', JSON.stringify(sh), JSON.stringify(st));
      db.raw
        .prepare('INSERT INTO characters(id,campaign_id,owner_email,sheet,state) VALUES(?,?,?,?,?)')
        .run('empty', 'c', 'u@example.invalid', '{}', '{}');
      migrateAndCompare(db);
      for (const row of db.raw.prepare('SELECT sheet,state FROM normalized_characters').all())
        assert(row.sheet && row.state);
    } finally {
      db.close();
    }
  }
});

test('invalid JSON, non-object roots and duplicate keys abort before any original data changes', () => {
  for (const invalid of [
    '{oops',
    '[]',
    'null',
    '{"Level":1,"Level":2}',
    '{"_baseStats":{"Strength":1,"Strength":2}}',
  ]) {
    const db = sqliteDB();
    try {
      db.raw.exec(legacySchema);
      db.raw.exec("INSERT INTO campaigns(id,name) VALUES('c','Campaign')");
      db.raw
        .prepare('INSERT INTO characters(id,campaign_id,owner_email,sheet,state) VALUES(?,?,?,?,?)')
        .run('h', 'c', 'u@example.invalid', invalid, '{}');
      assert.throws(() => migrateAndCompare(db));
      assert.equal(
        db.raw.prepare("SELECT sheet FROM characters WHERE id='h'").get().sheet,
        invalid,
      );
      assert.equal(
        db.raw.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='character_profiles'").get()
          .n,
        0,
      );
    } finally {
      db.close();
    }
  }
});

test('local migration is repeatable and rejects corrupt later writes atomically', () => {
  const db = fixture();
  try {
    db.raw.exec(
      "CREATE TABLE local_migrations(name TEXT PRIMARY KEY); INSERT INTO local_migrations VALUES('0001.sql'),('0002_owner_console.sql')",
    );
    migrateLocal(db);
    migrateLocal(db);
    const before = db.raw.prepare("SELECT * FROM characters WHERE id='hero'").get();
    assert.throws(
      () => db.raw.exec("UPDATE characters SET state='[]',version=version+1 WHERE id='hero'"),
      /normalization/,
    );
    assert.deepEqual(db.raw.prepare("SELECT * FROM characters WHERE id='hero'").get(), before);
    assert.throws(
      () =>
        db.raw.exec(`UPDATE definitions SET payload='{"Name":"a","Name":"b"}' WHERE id='faith'`),
      /duplicate/,
    );
    assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('legacy CLI writes update columns, perks and resolved references without changing rowcount semantics', () => {
  const db = fixture();
  try {
    migrateAndCompare(db);
    assert.equal(
      db.raw
        .prepare(
          "UPDATE characters SET state=json_set(state,'$.hp',-99) WHERE id='hero' AND version=13",
        )
        .run().changes,
      1,
    );
    assert.equal(db.raw.prepare('SELECT changes() n').get().n, 1);
    assert.equal(
      db.raw.prepare("SELECT hp FROM character_resources WHERE id='hero'").get().hp,
      -99,
    );
    db.raw.prepare('INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)').run(
      'spell',
      'missing-spell',
      JSON.stringify({
        system_id: 'missing-spell',
        School: 'wind',
        'Spell Name (Chinese)': 'Recovered',
      }),
    );
    assert(db.raw.prepare("SELECT 1 FROM definition_links WHERE target_id='missing-spell'").get());
    db.raw.prepare("UPDATE definitions SET payload=? WHERE kind='class' AND id='ranger'").run(
      JSON.stringify({
        system_id: 'ranger',
        'Class Name (Chinese)': '游俠',
        'Level 1 Perk': null,
        'Level 8 Perk': false,
      }),
    );
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM class_perks').get().n, 2);
    assert.deepEqual(
      JSON.parse(
        db.raw.prepare("SELECT payload FROM normalized_definitions WHERE kind='class'").get()
          .payload,
      ),
      {
        system_id: 'ranger',
        'Class Name (Chinese)': '游俠',
        'Level 1 Perk': null,
        'Level 8 Perk': false,
      },
    );
    db.raw.exec("DELETE FROM character_weapons WHERE character_id='hero'");
    assert.equal(
      db.raw
        .prepare(
          "SELECT COUNT(*) n FROM definition_links WHERE field='Weapons' AND source_id='hero'",
        )
        .get().n,
      0,
    );
    assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('API mutation sequence matches legacy reads, including stale CAS, replay, undo, private data and rest', async () => {
  const db = fixture();
  try {
    migrateAndCompare(db);
    // A second independent database exercises writes through the old-read adapter.
    const old = fixture();
    migrateAndCompare(old);
    const handler = createHandler();
    for (const d of [db, old])
      d.raw
        .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
        .run(await hash('a'.repeat(64)), 'owner', 'csrf', Date.now() + 60000);
    const invoke = (d, endpoint, body, method = 'POST') =>
      handler(
        new Request('https://test.invalid' + endpoint, {
          method,
          headers: {
            Cookie: '__Host-oria_session=' + 'a'.repeat(64),
            Origin: 'https://test.invalid',
            'X-CSRF-Token': 'csrf',
          },
          body: JSON.stringify(body),
        }),
        { DB: d, APP_ORIGIN: 'https://test.invalid' },
      );
    try {
      const actions = [
        [
          '/api/characters/hero/resource',
          {
            operationId: 'damage-normalize',
            command: { kind: 'damage', amount: 12, exempt: false },
          },
        ],
        [
          '/api/characters/hero/resource',
          {
            operationId: 'damage-normalize',
            command: { kind: 'damage', amount: 12, exempt: false },
          },
        ],
        [
          '/api/characters/hero/private',
          { field: 'inventory', value: 'anything\nfree text', version: 13 },
          'PATCH',
        ],
        [
          '/api/characters/hero/private',
          { field: 'inventory', value: 'anything\nfree text', version: 14 },
          'PATCH',
        ],
        ['/api/characters/hero/undo', { operationId: 'damage-normalize' }],
        [
          '/api/characters/hero/resource',
          { operationId: 'normalize-prayer', command: { kind: 'pray' } },
        ],
      ];
      for (const [index, [endpoint, body, method]] of actions.entries()) {
        const a = await invoke(legacyReads(old), endpoint, body, method),
          b = await invoke(db, endpoint, body, method);
        assert.equal(a.status, [200, 200, 409, 200, 409, 200][index]);
        assert.equal(b.status, a.status);
        assert.deepEqual(await b.json(), await a.json());
        assert.equal(await compareBootstrapAPIs(db), 8);
      }
    } finally {
      old.close();
    }
  } finally {
    db.close();
  }
});

test('views respect the D1 limit of 5 compound SELECT terms', () => {
  for (const [, name, sql] of migration.matchAll(/CREATE VIEW (\w+) AS ([\s\S]*?);/g))
    assert((sql.match(/\bUNION ALL\b/g) || []).length + 1 <= 5, name);
});

test('catalog arrays retain legacy insertion order after unrelated content is added', async () => {
  const db = fixture();
  try {
    for (const id of ['z-last', 'a-first', 'middle'])
      db.raw
        .prepare('INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)')
        .run(
          'spell',
          id,
          JSON.stringify({ system_id: id, School: 'wind', 'Spell Name (Chinese)': id }),
        );
    migrateAndCompare(db);
    assert.equal(await compareBootstrapAPIs(db), 8);
  } finally {
    db.close();
  }
});

test('followup rehearsal preserves original columns and only permits the declared info API additions', async () => {
  const db = fixture();
  try {
    migrateAndCompare(db);
    assert.deepEqual(applyFollowupMigrations(db), ['0004_campaign_controls.sql']);
    assert.equal(
      db.raw.prepare("SELECT quantity FROM character_weapons WHERE character_id='hero'").get()
        .quantity,
      1,
    );
    const handler = createHandler();
    const oldContract = async (req, env) => {
      const response = await handler(req, env),
        body = await response.json();
      if (body.data) delete body.data.info;
      if (body.catalog) body.catalog = body.catalog.filter((x) => x.kind !== 'info');
      return new Response(JSON.stringify(body), { status: response.status });
    };
    await assert.rejects(compareCoreAPIs(db, oldContract), /API body mismatch/);
    assert.equal(await compareCoreAPIs(db, oldContract, { allowAddedInfo: true }), 8);
    const changedCharacter = async (req, env) => {
      const response = await oldContract(req, env),
        body = await response.json();
      if (body.data?.character.length) body.data.character[0].Level = '999';
      return new Response(JSON.stringify(body), { status: response.status });
    };
    await assert.rejects(
      compareCoreAPIs(db, changedCharacter, { allowAddedInfo: true }),
      /API body mismatch/,
    );
  } finally {
    db.close();
  }
});
