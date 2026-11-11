import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { setup } from './fixtures/api-fixture.mjs';
import { sqliteDB } from '../scripts/sqlite-adapter.mjs';
import { summary } from '../scripts/maintain.mjs';

import { addCampaignDefinitions } from './fixtures/campaign-definitions.mjs';
const row = (db) => db.raw.prepare("SELECT * FROM characters WHERE id='hero'").get();
const loadout = (request, actor, body) =>
  request(actor, '/api/characters/hero/loadout', 'PATCH', body);

test('owner can carry multiple identical weapons and change multiple beliefs without recalculating stats', async () => {
  const { db, request } = await setup();
  try {
    addCampaignDefinitions(db);
    const before = row(db);
    const response = await loadout(request, 'owner', {
      version: 0,
      weapons: [
        { id: 'blade', quantity: 3 },
        { id: 'shield', quantity: 1 },
      ],
      beliefs: ['faith', 'other-faith'],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, version: 1 });
    const after = row(db);
    assert.equal(after.state, before.state);
    for (const key of ['Max Health', 'Max Willpower', 'Strength', 'Dexterity', 'Level'])
      assert.equal(JSON.parse(after.sheet)[key], JSON.parse(before.sheet)[key]);
    assert.deepEqual(
      db.raw
        .prepare(
          "SELECT weapon_id,quantity FROM character_weapons WHERE character_id='hero' ORDER BY weapon_id",
        )
        .all()
        .map((x) => ({ ...x })),
      [
        { weapon_id: 'blade', quantity: 3 },
        { weapon_id: 'shield', quantity: 1 },
      ],
    );
    assert.equal(
      db.raw.prepare("SELECT COUNT(*) n FROM character_beliefs WHERE character_id='hero'").get().n,
      2,
    );
    const boot = await (await request('other', '/api/bootstrap')).json();
    assert.equal(
      boot.data.character.find((c) => c.system_id === 'hero').Weapons,
      'blade , blade , blade , shield',
    );
    assert(!boot.state.characters.hero.inventory);
    assert(!boot.state.characters.hero.general);
    assert.equal((await loadout(request, 'owner', { version: 1, weapons: [] })).status, 200);
    assert.equal(
      db.raw.prepare("SELECT COUNT(*) n FROM character_weapons WHERE character_id='hero'").get().n,
      0,
    );
    assert.equal(JSON.parse(row(db).sheet).Beliefs, 'faith , other-faith');
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, 2);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_checks').get().n, 0);
    assert.deepEqual(db.raw.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});

test('loadout rejects foreign ownership, readers, inactive campaign, stale versions and invalid quantities', async () => {
  const { db, request } = await setup();
  try {
    addCampaignDefinitions(db);
    for (const actor of ['other', 'reader'])
      assert.equal(
        (await loadout(request, actor, { version: 0, weapons: [{ id: 'blade', quantity: 2 }] }))
          .status,
        403,
      );
    assert.equal(
      (
        await request('owner', '/api/characters/oldhero/loadout', 'PATCH', {
          version: 0,
          beliefs: ['faith'],
        })
      ).status,
      404,
    );
    for (const weapons of [
      [{ id: 'blade', quantity: 0 }],
      [{ id: 'blade', quantity: -1 }],
      [{ id: 'blade', quantity: 1.1 }],
      [{ id: 'blade', quantity: 1001 }],
      [
        { id: 'blade', quantity: 1 },
        { id: 'blade', quantity: 1 },
      ],
      [{ id: 'missing', quantity: 1 }],
      [{ id: 'locked', quantity: 1 }],
    ])
      assert.equal((await loadout(request, 'owner', { version: 0, weapons })).status, 400);
    assert.equal(
      (await loadout(request, 'owner', { version: 0, beliefs: ['locked-faith'] })).status,
      400,
    );
    assert.equal(
      (await loadout(request, 'owner', { version: 0, beliefs: ['faith', 'faith'] })).status,
      400,
    );
    assert.equal((await loadout(request, 'owner', { version: 0, beliefs: ['faith'] })).status, 200);
    assert.equal((await loadout(request, 'owner', { version: 0, weapons: [] })).status, 409);
    assert.equal(row(db).version, 1);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, 1);
  } finally {
    db.close();
  }
});

test('existing unavailable equipment can be retained or reduced, while new acquisitions are checked', async () => {
  const { db, request } = await setup();
  try {
    addCampaignDefinitions(db);
    db.raw.exec(
      "INSERT INTO character_weapons(character_id,weapon_id,quantity) VALUES('hero','locked',3)",
    );
    assert.equal(
      (await loadout(request, 'owner', { version: 0, weapons: [{ id: 'locked', quantity: 2 }] }))
        .status,
      200,
    );
    assert.equal(
      (await loadout(request, 'owner', { version: 1, weapons: [{ id: 'locked', quantity: 3 }] }))
        .status,
      400,
    );
    assert.equal((await loadout(request, 'owner', { version: 1, weapons: [] })).status, 200);
  } finally {
    db.close();
  }
});

test('loadout guards detect definition edits and revoked permissions at commit time', async () => {
  for (const race of ['definition', 'permission']) {
    const { db, request } = await setup();
    try {
      addCampaignDefinitions(db);
      const before = row(db),
        original = db.batch.bind(db);
      db.batch = async (statements) => {
        if (race === 'definition')
          db.raw.exec(
            "UPDATE definitions SET payload=json_set(payload,'$.Available',json('false')) WHERE kind='weapon' AND id='blade'",
          );
        else db.raw.exec("DELETE FROM access_grants WHERE user_id='owner'");
        return original(statements);
      };
      assert.equal(
        (await loadout(request, 'owner', { version: 0, weapons: [{ id: 'blade', quantity: 2 }] }))
          .status,
        409,
      );
      assert.deepEqual(row(db), before);
      assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, 0);
      assert.equal(
        db.raw.prepare("SELECT COUNT(*) n FROM character_weapons WHERE character_id='hero'").get()
          .n,
        0,
      );
    } finally {
      db.close();
    }
  }
});

test('DM resource edits permit negative HP, respect maxima, retain wounds and support replay/undo', async () => {
  const { db, request } = await setup();
  try {
    const old = JSON.parse(row(db).state);
    old.wounds = [3, 3];
    db.raw.prepare("UPDATE characters SET state=? WHERE id='hero'").run(JSON.stringify(old));
    const body = {
      operationId: 'dm-adjust-resource',
      command: { kind: 'adjust', hp: -12, will: 2 },
    };
    const first = await request('dm', '/api/characters/hero/resource', 'POST', body);
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.state.hp, -12);
    assert.equal(result.state.will, 2);
    assert.deepEqual(result.state.wounds, [3, 3]);
    assert.equal(result.state.temp, old.temp);
    const replay = await (
      await request('dm', '/api/characters/hero/resource', 'POST', body)
    ).json();
    assert.equal(replay.replayed, true);
    assert.equal(replay.version, 1);
    assert.equal(
      (await request('dm', '/api/characters/hero/undo', 'POST', { operationId: body.operationId }))
        .status,
      200,
    );
    assert.deepEqual(JSON.parse(row(db).state), old);
    assert.equal(JSON.parse(row(db).sheet)['Max Health'], '15');
  } finally {
    db.close();
  }
});

test('players cannot forge DM resource changes; invalid inputs and a revoked DM grant cannot write state', async () => {
  const { db, request } = await setup();
  try {
    const before = row(db);
    for (const actor of ['owner', 'other', 'reader'])
      assert.equal(
        (
          await request(actor, '/api/characters/hero/resource', 'POST', {
            operationId: 'forged-dm-' + actor,
            command: { kind: 'adjust', hp: 200, will: 10 },
          })
        ).status,
        403,
      );
    for (const command of [
      { kind: 'adjust' },
      { kind: 'adjust', hp: 0.5 },
      { kind: 'adjust', will: -1 },
      { kind: 'adjust', hp: 100001 },
    ])
      assert.equal(
        (
          await request('dm', '/api/characters/hero/resource', 'POST', {
            operationId: 'invalid-adjust-' + crypto.randomUUID(),
            command,
          })
        ).status,
        400,
      );
    const original = db.batch.bind(db);
    db.batch = async (statements) => {
      db.raw.exec("DELETE FROM access_grants WHERE user_id='dm'");
      return original(statements);
    };
    assert.equal(
      (
        await request('dm', '/api/characters/hero/resource', 'POST', {
          operationId: 'revoked-dm-adjust',
          command: { kind: 'adjust', hp: 0 },
        })
      ).status,
      403,
    );
    assert.deepEqual(row(db), before);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, 0);
  } finally {
    db.close();
  }
});

test('CSV information keeps all stable IDs and text, and only the site owner can edit, archive and restore it', async () => {
  const { db, request } = await setup();
  try {
    const seed = JSON.parse(
      fs.readFileSync(new URL('../content/archive-info.json', import.meta.url), 'utf8'),
    );
    const body = await (await request('reader', '/api/bootstrap')).json();
    assert.deepEqual(body.data.info, seed);
    assert.equal(summary(db.raw).archive_info, 10);
    db.raw.exec("INSERT INTO site_owner VALUES(1,'owner',1)");
    const article = seed[0],
      payload = {
        ...article,
        Name: '測試資訊',
        Content: '<script>alert(1)</script>\n\nPlain text',
      };
    for (const actor of ['reader', 'other', 'dm'])
      assert.equal(
        (
          await request(actor, '/api/owner/content', 'POST', {
            kind: 'info',
            id: article.system_id,
            version: 0,
            payload,
          })
        ).status,
        403,
      );
    assert.equal(
      (
        await request('owner', '/api/owner/content', 'POST', {
          kind: 'info',
          id: article.system_id,
          version: 0,
          payload,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request('owner', '/api/owner/content', 'POST', {
          kind: 'info',
          id: article.system_id,
          version: 0,
          payload,
        })
      ).status,
      409,
    );
    const archive = { kind: 'info', id: article.system_id, version: 1, archived: true };
    assert.equal(
      (await request('owner', '/api/owner/content/archive', 'POST', archive)).status,
      200,
    );
    assert(
      !(await (await request('reader', '/api/bootstrap')).json()).data.info.some(
        (x) => x.system_id === article.system_id,
      ),
    );
    const catalog = await (await request('owner', '/api/owner/bootstrap')).json();
    assert.equal(
      catalog.catalog.find((x) => x.kind === 'info' && x.id === article.system_id).payload.Content,
      payload.Content,
    );
    assert.equal(
      (
        await request('owner', '/api/owner/content/archive', 'POST', {
          ...archive,
          version: 2,
          archived: false,
        })
      ).status,
      200,
    );
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_audit').get().n, 3);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_checks').get().n, 0);
  } finally {
    db.close();
  }
});

test('info edits are audited atomically and external content changes without a version bump are detected', async () => {
  const { db, request } = await setup();
  try {
    db.raw.exec("INSERT INTO site_owner VALUES(1,'owner',1)");
    const original = db.batch.bind(db);
    db.batch = async (statements) => {
      db.raw.exec("UPDATE archive_info SET content='Concurrent change' WHERE id='17512122'");
      return original(statements);
    };
    assert.equal(
      (
        await request('owner', '/api/owner/content', 'POST', {
          kind: 'info',
          id: '17512122',
          version: 0,
          payload: { system_id: '17512122', Name: 'Stale', Content: 'Stale' },
        })
      ).status,
      409,
    );
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM owner_audit').get().n, 0);
    assert.equal(
      db.raw.prepare("SELECT content FROM archive_info WHERE id='17512122'").get().content,
      'Concurrent change',
    );
  } finally {
    db.close();
  }
});

test('0004 preserves existing weapon relationships, character snapshots, versions and notes', () => {
  const db = sqliteDB();
  try {
    for (const file of ['0001.sql', '0002_owner_console.sql', '0003_normalize_core.sql'])
      db.raw.exec(fs.readFileSync(new URL('../migrations/' + file, import.meta.url), 'utf8'));
    db.raw.exec(
      "INSERT INTO users(id,email) VALUES('u','synthetic@example.invalid');INSERT INTO campaigns(id,name) VALUES('c','Campaign');INSERT INTO characters(id,campaign_id,owner_email,sheet,state,version) VALUES('h','c','synthetic@example.invalid','{}','{}',17);INSERT INTO character_weapons VALUES('h','blade');INSERT INTO session_notes VALUES('n','h','u','Title','2026-11-11','Keep me',3,0)",
    );
    const before = db.raw.prepare('SELECT * FROM characters').get();
    db.raw.exec(
      fs.readFileSync(new URL('../migrations/0004_campaign_controls.sql', import.meta.url), 'utf8'),
    );
    assert.deepEqual(db.raw.prepare('SELECT * FROM characters').get(), before);
    assert.deepEqual(
      { ...db.raw.prepare('SELECT * FROM character_weapons').get() },
      { character_id: 'h', weapon_id: 'blade', quantity: 1 },
    );
    assert.equal(db.raw.prepare('SELECT body FROM session_notes').get().body, 'Keep me');
    assert.throws(() => db.raw.exec('UPDATE character_weapons SET quantity=0'), /CHECK/);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM archive_info').get().n, 10);
  } finally {
    db.close();
  }
});

test('wound settlement shares HP feedback, prayer emits sparks, and reduced motion suppresses both', () => {
  const source = fs.readFileSync(new URL('../frontend/motion.js', import.meta.url), 'utf8');
  for (const reduce of [false, true]) {
    const animations = [],
      particles = [];
    const surface = {
      animate: (frames, options) => {
        animations.push({ frames, options });
        return { cancel() {}, finished: Promise.resolve() };
      },
      append: (n) => particles.push(n),
      querySelector: () => null,
      clientHeight: 200,
    };
    const context = {
      WeakMap,
      Math,
      matchMedia: () => ({ matches: reduce }),
      $: () => surface,
      MutationObserver: class {
        observe() {}
      },
      document: {
        querySelector: () => ({ addEventListener() {} }),
        addEventListener() {},
        createElement: () => ({
          style: {},
          setAttribute() {},
          animate: surface.animate,
          remove() {},
        }),
      },
    };
    vm.runInNewContext(source, context);
    vm.runInNewContext("animateResourceFeedback('settle')", context);
    assert.equal(animations.length, reduce ? 0 : 2);
    animations.length = 0;
    vm.runInNewContext("animateResourceFeedback('stop')", context);
    assert.equal(animations.length, 0);
    vm.runInNewContext("animateResourceFeedback('pray')", context);
    assert.equal(particles.length > 0, !reduce);
    assert.equal(animations.length > 0, !reduce);
  }
});

test('large loadouts remain below the D1 Free per-request query budget', async () => {
  const { db, request } = await setup();
  try {
    const weapons = Array.from({ length: 100 }, (_, i) => ({ id: 'item-' + i, quantity: 1 }));
    for (const w of weapons)
      db.raw
        .prepare('INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)')
        .run(
          'weapon',
          w.id,
          JSON.stringify({ system_id: w.id, 'Weapon Name': w.id, Available: true }),
        );
    const prepare = db.prepare.bind(db);
    let queries = 0;
    db.prepare = (sql) => {
      queries++;
      return prepare(sql);
    };
    assert.equal((await loadout(request, 'owner', { version: 0, weapons })).status, 200);
    assert(queries < 50, `Used ${queries} D1 queries`);
    assert.equal(
      db.raw.prepare("SELECT COUNT(*) n FROM character_weapons WHERE character_id='hero'").get().n,
      100,
    );
  } finally {
    db.close();
  }
});

test('malformed controls fail validation and a campaign switch cannot race a player resource update', async () => {
  const { db, request } = await setup();
  try {
    assert.equal((await loadout(request, 'owner', null)).status, 400);
    assert.equal(
      (
        await request('dm', '/api/characters/hero/resource', 'POST', {
          operationId: 'missing-command',
        })
      ).status,
      400,
    );
    const before = row(db),
      original = db.batch.bind(db);
    db.batch = async (statements) => {
      db.raw.exec("UPDATE campaigns SET active=0 WHERE id='active'");
      return original(statements);
    };
    assert.equal(
      (
        await request('owner', '/api/characters/hero/resource', 'POST', {
          operationId: 'campaign-switch-race',
          command: { kind: 'temp', amount: 1 },
        })
      ).status,
      404,
    );
    assert.deepEqual(row(db), before);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, 0);
  } finally {
    db.close();
  }
});
