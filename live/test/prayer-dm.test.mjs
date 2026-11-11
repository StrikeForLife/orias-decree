import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixtures/api-fixture.mjs';
const row = (db) => db.raw.prepare("SELECT * FROM characters WHERE id='hero'").get();

test('prayer records a selected owned belief, rejects foreign choices, and remains replay-safe', async () => {
  const { db, request } = await setup();
  try {
    db.raw.exec(
      "UPDATE characters SET sheet=json_set(sheet,'$.Beliefs','faith , legacy-faith') WHERE id='hero'",
    );
    const before = row(db);
    for (const beliefId of ['foreign', '', 42, null])
      assert.equal(
        (
          await request('owner', '/api/characters/hero/resource', 'POST', {
            operationId: crypto.randomUUID(),
            command: { kind: 'pray', beliefId },
          })
        ).status,
        400,
      );
    assert.deepEqual(row(db), before);
    const action = {
      operationId: 'chosen-prayer-123',
      command: { kind: 'pray', beliefId: 'legacy-faith' },
    };
    const first = await (
      await request('owner', '/api/characters/hero/resource', 'POST', action)
    ).json();
    assert.equal(first.state.will, 1);
    assert.notEqual(first.replayed, true);
    const replay = await (
      await request('owner', '/api/characters/hero/resource', 'POST', action)
    ).json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.state.will, 1);
    assert.equal(
      JSON.parse(db.raw.prepare('SELECT request FROM operations').get().request).beliefId,
      'legacy-faith',
    );
    assert.equal(
      (
        await request('other', '/api/characters/hero/resource', 'POST', {
          ...action,
          operationId: 'foreign-pray-123',
        })
      ).status,
      403,
    );
    const legacy = await request('owner', '/api/characters/hero/resource', 'POST', {
      operationId: 'legacy-pray-123',
      command: { kind: 'pray' },
    });
    assert.equal(legacy.status, 200);
    assert.equal((await legacy.json()).state.will, 0);
  } finally {
    db.close();
  }
});

test('DM resource sliders are enforced by the API; old over-max values survive unrelated adjustments', async () => {
  const { db, request } = await setup();
  try {
    db.raw.exec(
      "UPDATE characters SET state=json_set(state,'$.hp',50,'$.will',8,'$.wounds',json('[4]')) WHERE id='hero'",
    );
    const before = row(db);
    for (const command of [
      { kind: 'adjust', hp: 16 },
      { kind: 'adjust', will: 3 },
    ])
      assert.equal(
        (
          await request('dm', '/api/characters/hero/resource', 'POST', {
            operationId: crypto.randomUUID(),
            command,
          })
        ).status,
        400,
      );
    assert.deepEqual(row(db), before);
    const response = await request('dm', '/api/characters/hero/resource', 'POST', {
      operationId: 'cap-will-123',
      command: { kind: 'adjust', will: 2 },
    });
    const result = await response.json();
    assert.equal(result.state.hp, 50);
    assert.equal(result.state.will, 2);
    assert.deepEqual(result.state.wounds, [4]);
    assert.equal(row(db).sheet, before.sheet);
  } finally {
    db.close();
  }
});

test('team rest heals only the active campaign, clears wounds, preserves temp HP and does not replay after later damage', async () => {
  const { db, request } = await setup();
  try {
    for (const id of ['hero', 'otherhero', 'oldhero'])
      db.raw
        .prepare(
          "UPDATE characters SET state=json_set(state,'$.hp',-3,'$.will',0,'$.wounds',json('[5,3]')) WHERE id=?",
        )
        .run(id);
    const old = db.raw.prepare("SELECT * FROM characters WHERE id='oldhero'").get();
    const action = { campaignId: 'active', operationId: 'full-team-rest-123' };
    assert.equal((await request('reader', '/api/admin/rest', 'POST', action)).status, 403);
    assert.equal((await request('dm', '/api/admin/rest', 'POST', action)).status, 200);
    for (const id of ['hero', 'otherhero']) {
      const state = JSON.parse(
        db.raw.prepare('SELECT state FROM characters WHERE id=?').get(id).state,
      );
      assert.equal(state.hp, 15);
      assert.equal(state.will, 2);
      assert.equal(state.temp, 2);
      assert.deepEqual(state.wounds, []);
    }
    assert.deepEqual(db.raw.prepare("SELECT * FROM characters WHERE id='oldhero'").get(), old);
    await request('owner', '/api/characters/hero/resource', 'POST', {
      operationId: 'damage-after-rest',
      command: { kind: 'damage', amount: 4, exempt: true },
    });
    const after = row(db);
    assert.equal((await request('dm', '/api/admin/rest', 'POST', action)).status, 200);
    assert.deepEqual(row(db), after);
    assert.equal(
      (await request('dm', '/api/admin/rest', 'POST', { ...action, campaignId: 'old' })).status,
      409,
    );
  } finally {
    db.close();
  }
});

test('settings preserve old resources unless level is explicitly changed; changed levels enforce the new caps', async () => {
  const { db, request } = await setup();
  try {
    db.raw.exec(
      "UPDATE characters SET state=json_set(state,'$.hp',50,'$.will',8,'$.wounds',json('[3]')) WHERE id='hero'",
    );
    const before = row(db);
    assert.equal(
      (
        await request('dm', '/api/admin/character', 'PATCH', {
          id: 'hero',
          version: 0,
          editClass: true,
        })
      ).status,
      200,
    );
    assert.equal(row(db).state, before.state);
    assert.equal(row(db).sheet, before.sheet);
    assert.equal(
      (await request('dm', '/api/admin/character', 'PATCH', { id: 'hero', version: 1, level: 4 }))
        .status,
      200,
    );
    const state = JSON.parse(row(db).state);
    assert.equal(state.hp, 38);
    assert.equal(state.will, 1);
    assert.equal(state.temp, 2);
    assert.deepEqual(state.wounds, [3]);
  } finally {
    db.close();
  }
});

test('large party rest stays within D1 query limits and permission races roll back the whole party', async () => {
  const { db, request } = await setup();
  try {
    const hero = row(db);
    for (let i = 0; i < 12; i++)
      db.raw
        .prepare(
          'INSERT INTO characters(id,campaign_id,owner_email,owner_user_id,sheet,state) VALUES(?,?,?,?,?,?)',
        )
        .run('party-' + i, 'active', hero.owner_email, hero.owner_user_id, hero.sheet, hero.state);
    let queries = 0;
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      queries++;
      return prepare(sql);
    };
    const r = await request('dm', '/api/admin/rest', 'POST', {
      campaignId: 'active',
      operationId: 'many-party-rest',
    });
    assert.equal(r.status, 200);
    assert(queries < 20, 'Party rest must have a constant query budget');
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, 14);
    const before = db.raw.prepare('SELECT * FROM characters ORDER BY id').all();
    const operations = db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n;
    const batch = db.batch.bind(db);
    db.batch = async (statements) => {
      db.raw.exec("DELETE FROM access_grants WHERE user_id='dm'");
      return batch(statements);
    };
    assert.equal(
      (
        await request('dm', '/api/admin/rest', 'POST', {
          campaignId: 'active',
          operationId: 'revoked-party-rest',
        })
      ).status,
      409,
    );
    assert.deepEqual(db.raw.prepare('SELECT * FROM characters ORDER BY id').all(), before);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, operations);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_checks').get().n, 0);
  } finally {
    db.close();
  }
});

test('a concurrent character version change prevents a partial team rest', async () => {
  const { db, request } = await setup();
  try {
    db.raw.exec("UPDATE characters SET state=json_set(state,'$.hp',2) WHERE campaign_id='active'");
    const other = db.raw.prepare("SELECT * FROM characters WHERE id='otherhero'").get();
    const batch = db.batch.bind(db);
    db.batch = async (statements) => {
      db.raw.exec(
        "UPDATE characters SET state=json_set(state,'$.hp',1),version=version+1 WHERE id='hero'",
      );
      return batch(statements);
    };
    assert.equal(
      (
        await request('dm', '/api/admin/rest', 'POST', {
          campaignId: 'active',
          operationId: 'conflicting-rest',
        })
      ).status,
      409,
    );
    assert.equal(JSON.parse(row(db).state).hp, 1);
    assert.deepEqual(db.raw.prepare("SELECT * FROM characters WHERE id='otherhero'").get(), other);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, 0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_checks').get().n, 0);
  } finally {
    db.close();
  }
});
