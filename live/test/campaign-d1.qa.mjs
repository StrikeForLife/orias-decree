/** Optional workerd/D1 integration check. Uses only synthetic in-memory data. */
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setup, schema } from './fixtures/api-fixture.mjs';
import { addCampaignDefinitions } from './fixtures/campaign-definitions.mjs';
import { createHandler } from '../server/worker.mjs';
const require = createRequire(import.meta.url);
const wranglerPackage = process.env.WRANGLER_MODULE_ROOT
  ? path.join(process.env.WRANGLER_MODULE_ROOT, 'package.json')
  : require.resolve('wrangler/package.json');
const wranglerRequire = createRequire(wranglerPackage);
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire('miniflare');
const { unstable_splitSqlQuery } = wranglerRequire('./wrangler-dist/cli.js');
const source = await setup();
addCampaignDefinitions(source.db);
source.db.raw.exec(
  "INSERT INTO site_owner VALUES(1,'owner',1);INSERT INTO character_weapons(character_id,weapon_id,quantity) VALUES('hero','blade',2);UPDATE characters SET state=json_set(state,'$.wounds',json('[3,3]')) WHERE id='hero'",
);
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {}',
    compatibilityDate: '2026-10-01',
    d1Databases: ['DB'],
  }),
);
try {
  const db = await mf.getD1Database('DB');
  await db.batch(unstable_splitSqlQuery(schema).map((sql) => db.prepare(sql)));
  const seed = [];
  for (const table of [
    'users',
    'campaigns',
    'access_grants',
    'definitions',
    'characters',
    'character_spells',
    'character_weapons',
    'sessions',
    'operations',
    'session_notes',
    'site_owner',
  ]) {
    for (const row of source.db.raw.prepare('SELECT * FROM ' + table).all())
      seed.push(
        db
          .prepare(
            'INSERT INTO ' +
              table +
              '(' +
              Object.keys(row).join(',') +
              ') VALUES(' +
              Object.keys(row)
                .map(() => '?')
                .join(',') +
              ')',
          )
          .bind(...Object.values(row)),
      );
  }
  await db.batch(seed);
  const handler = createHandler(),
    env = {
      DB: db,
      APP_ORIGIN: 'https://oria.example',
      GOOGLE_CLIENT_ID: 'isolated-test',
      ASSETS: { fetch: () => new Response('test') },
    };
  const call = (actor, path, body, method = 'POST') =>
    handler(
      new Request(env.APP_ORIGIN + path, {
        method,
        headers: {
          Cookie: '__Host-oria_session=' + Buffer.from(actor).toString('hex').padEnd(64, '0'),
          Origin: env.APP_ORIGIN,
          'X-CSRF-Token': 'csrf-' + actor,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
  assert.equal(
    (
      await call(
        'owner',
        '/api/characters/hero/loadout',
        {
          version: 0,
          weapons: [
            { id: 'blade', quantity: 3 },
            { id: 'shield', quantity: 2 },
          ],
          beliefs: ['faith', 'other-faith'],
        },
        'PATCH',
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT quantity FROM character_weapons WHERE character_id='hero' AND weapon_id='blade'",
        )
        .first()
    ).quantity,
    3,
  );
  assert.equal(
    (await call('owner', '/api/characters/hero/loadout', { version: 0, weapons: [] }, 'PATCH'))
      .status,
    409,
  );
  const adjust = {
    operationId: 'd1-free-adjustment',
    command: { kind: 'adjust', hp: -9, will: 2 },
  };
  assert.equal((await call('owner', '/api/characters/hero/resource', adjust)).status, 403);
  const result = await call('dm', '/api/characters/hero/resource', adjust);
  assert.equal(result.status, 200);
  const value = await result.json();
  assert.notEqual(value.replayed, true, 'A first D1 resource update must not be labelled a replay');
  assert.equal(value.state.hp, -9);
  assert.equal(value.state.will, 2);
  assert.deepEqual(value.state.wounds, [3, 3]);
  assert.equal(
    (await (await call('dm', '/api/characters/hero/resource', adjust)).json()).replayed,
    true,
  );
  assert.equal(
    (await call('dm', '/api/characters/hero/undo', { operationId: adjust.operationId })).status,
    200,
  );
  const counted = await db.batch([
    db.prepare("UPDATE characters SET state=state WHERE id='hero'"),
    db.prepare('SELECT changes() AS n'),
  ]);
  assert(counted[0].meta.changes > 1, 'D1 metadata must include normalization-trigger writes');
  assert.equal(counted[1].results[0].n, 1, 'SQL changes() still counts only the direct row');
  for (const [i, command] of [
    { kind: 'damage', amount: 1, exempt: false },
    { kind: 'settle', index: 0 },
    { kind: 'pray' },
  ].entries()) {
    const action = { operationId: 'd1-visible-feedback-' + i, command };
    const firstResponse = await call('owner', '/api/characters/hero/resource', action);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.notEqual(first.replayed, true, command.kind + ' must allow first-use animation');
    const repeated = await (await call('owner', '/api/characters/hero/resource', action)).json();
    assert.equal(repeated.replayed, true);
    assert.equal(repeated.version, first.version);
    assert.deepEqual(repeated.state, first.state);
  }
  const restBody = { campaignId: 'active', operationId: 'd1-full-party-rest' };
  assert.equal((await call('dm', '/api/admin/rest', restBody)).status, 200);
  const recovered = JSON.parse(
    (await db.prepare("SELECT state FROM characters WHERE id='hero'").first()).state,
  );
  assert.equal(recovered.hp, 15);
  assert.equal(recovered.will, 2);
  assert.equal(recovered.temp, 1);
  assert.deepEqual(recovered.wounds, []);
  assert.equal((await call('dm', '/api/admin/rest', restBody)).status, 200);
  assert.equal(
    (
      await call('dm', '/api/owner/content', {
        kind: 'info',
        id: '17512122',
        version: 0,
        payload: { system_id: '17512122', Name: '資訊', Content: 'Test' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call('owner', '/api/owner/content', {
        kind: 'info',
        id: '17512122',
        version: 0,
        payload: { system_id: '17512122', Name: '資訊', Content: 'Plain text\n\nUpdated' },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call('owner', '/api/owner/content/archive', {
        kind: 'info',
        id: '17512122',
        version: 1,
        archived: true,
      })
    ).status,
    200,
  );
  const bootstrap = await (await call('reader', '/api/bootstrap', undefined, 'GET')).json();
  assert.equal(bootstrap.data.info.length, 9);
  assert(!('inventory' in bootstrap.state.characters.hero));
  assert.equal((await db.prepare('PRAGMA quick_check').first()).quick_check, 'ok');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM owner_checks').first()).n, 0);
  console.log(
    'Local D1 QA passed: all migrations, quantities, loadout CAS, beliefs, DM resources/replay/undo, owner-only info CRUD, privacy, quick_check and foreign keys.',
  );
} finally {
  source.db.close();
  await mf.dispose();
}
