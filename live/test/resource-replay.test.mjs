import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixtures/api-fixture.mjs';

test('D1-style metadata includes trigger writes while SQL changes() remains the direct row count', async () => {
  const { db } = await setup();
  try {
    const direct = await db.prepare("UPDATE characters SET state=state WHERE id='hero'").run();
    assert(
      direct.meta.changes > 1,
      'The local adapter must expose normalized trigger writes like D1',
    );
    assert.equal(db.raw.prepare('SELECT changes() n').get().n, 1);
    const batch = await db.batch([
      db.prepare("UPDATE characters SET state=state WHERE id='hero'"),
      db.prepare('SELECT changes() n'),
    ]);
    assert(batch[0].meta.changes > 1);
    assert.equal(batch[1].meta.changes, 0);
    const missing = await db.prepare("UPDATE characters SET state=state WHERE id='missing'").run();
    assert.equal(missing.meta.changes, 0);
  } finally {
    db.close();
  }
});

test('fresh damage, wound and prayer actions trigger feedback; only repeated operation IDs are replayed', async () => {
  const { db, request } = await setup();
  try {
    db.raw.exec(
      "UPDATE characters SET state=json_set(state,'$.wounds',json('[2]')) WHERE id='hero'",
    );
    const commands = [
      { kind: 'damage', amount: 1, exempt: false },
      { kind: 'settle', index: 0 },
      { kind: 'pray' },
    ];
    let version = 0;
    for (const [i, command] of commands.entries()) {
      const body = { operationId: 'trigger-feedback-' + i, command };
      const response = await request('owner', '/api/characters/hero/resource', 'POST', body);
      assert.equal(response.status, 200);
      const first = await response.json();
      assert.notEqual(first.replayed, true, command.kind + ' must trigger first-use feedback');
      assert.equal(first.version, ++version);
      const replay = await (
        await request('owner', '/api/characters/hero/resource', 'POST', body)
      ).json();
      assert.equal(replay.replayed, true);
      assert.equal(replay.version, first.version);
      assert.deepEqual(replay.state, first.state);
      assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, version);
    }
    const state = JSON.parse(
      db.raw.prepare("SELECT state FROM characters WHERE id='hero'").get().state,
    );
    assert.equal(state.hp, 13);
    assert.equal(state.temp, 1);
    assert.equal(state.will, 1);
    assert.deepEqual(state.wounds, []);
  } finally {
    db.close();
  }
});
