import { fail } from './auth.mjs';
import { integer, splitIds } from './game.mjs';
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
const selectable = (v) => ![false, 0, 'FALSE', 'false'].includes(v);
export async function changeLoadout(db, s, c, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) fail(400, '裝備修改格式無效');
  if (!(c.role === 'dm' || (c.owner_user_id === s.user_id && c.role === 'player')))
    fail(403, '沒有角色裝備修改權');
  if (
    Object.keys(b).some((k) => !['version', 'weapons', 'beliefs'].includes(k)) ||
    (b.weapons === undefined && b.beliefs === undefined)
  )
    fail(400, '裝備修改格式無效');
  const expected = integer(b.version, 0, Number.MAX_SAFE_INTEGER);
  if (c.version !== expected) fail(409, '角色已更新，請先重新載入');
  const sh = JSON.parse(c.sheet),
    currentWeapons = (
      await stmt(
        db,
        'SELECT weapon_id,quantity FROM character_weapons WHERE character_id=?',
        c.id,
      ).all()
    ).results;
  const current = new Map(currentWeapons.map((w) => [w.weapon_id, w.quantity]));
  const weapons =
    b.weapons === undefined
      ? currentWeapons.map((w) => ({ id: w.weapon_id, quantity: w.quantity }))
      : b.weapons;
  const beliefs = b.beliefs === undefined ? splitIds(sh.Beliefs) : b.beliefs;
  if (
    !Array.isArray(weapons) ||
    weapons.length > 100 ||
    !Array.isArray(beliefs) ||
    beliefs.length > 20
  )
    fail(400, '裝備或信仰數量無效');
  const ids = new Set();
  let total = 0;
  for (const w of weapons) {
    if (
      !w ||
      Object.keys(w).some((k) => !['id', 'quantity'].includes(k)) ||
      typeof w.id !== 'string' ||
      !/^[-\w]{1,100}$/.test(w.id) ||
      ids.has(w.id)
    )
      fail(400, '武器 ID 或數量重複，請以數量欄位填寫');
    ids.add(w.id);
    total += integer(w.quantity, 1, 1000);
  }
  if (total > 1000) fail(400, '武器總數超出範圍');
  if (
    new Set(beliefs).size !== beliefs.length ||
    beliefs.some((id) => typeof id !== 'string' || !/^[-\w]{1,100}$/.test(id))
  )
    fail(400, '信仰 ID 無效或重複');
  const selectedRefs = [
    ...weapons
      .filter((w) => w.quantity > (current.get(w.id) || 0))
      .map((w) => ({ kind: 'weapon', id: w.id, flag: 'Available' })),
    ...beliefs
      .filter((id) => !splitIds(sh.Beliefs).includes(id))
      .map((id) => ({ kind: 'beliefs', id, flag: 'Enable' })),
  ];
  // One lookup and one transactional guard keep even a large loadout within
  // D1's per-request query budget. Snapshot payloads catch CLI edits too.
  const definitions = selectedRefs.length
    ? (
        await stmt(
          db,
          "SELECT d.* FROM definitions d WHERE EXISTS(SELECT 1 FROM json_each(?) r WHERE d.kind=json_extract(r.value,'$.kind') AND d.id=json_extract(r.value,'$.id'))",
          JSON.stringify(selectedRefs),
        ).all()
      ).results
    : [];
  const snapshots = selectedRefs.map((ref) => {
    const row = definitions.find((d) => d.kind === ref.kind && d.id === ref.id);
    if (!row || row.archived || !selectable(JSON.parse(row.payload)[ref.flag]))
      fail(400, '找不到可選用的' + (ref.kind === 'weapon' ? '武器' : '信仰'));
    return { kind: row.kind, id: row.id, version: row.version, payload: row.payload };
  });
  const guardId = 'loadout:' + crypto.randomUUID(),
    definitionsGuardId = guardId + ':definitions';
  const definitionGuard = stmt(
    db,
    "INSERT INTO owner_checks(id,ok) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM json_each(?) r WHERE NOT EXISTS(SELECT 1 FROM definitions d WHERE d.kind=json_extract(r.value,'$.kind') AND d.id=json_extract(r.value,'$.id') AND d.archived=0 AND d.version=json_extract(r.value,'$.version') AND d.payload=json_extract(r.value,'$.payload'))) THEN 1 ELSE 0 END",
    definitionsGuardId,
    JSON.stringify(snapshots),
  );
  const authorization = stmt(
    db,
    "INSERT INTO owner_checks(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM characters c JOIN campaigns p ON p.id=c.campaign_id JOIN access_grants a ON a.campaign_id=c.campaign_id AND a.user_id=? WHERE c.id=? AND c.version=? AND (a.role='dm' OR (p.active=1 AND a.role='player' AND c.owner_user_id=?))) THEN 1 ELSE 0 END",
    guardId,
    s.user_id,
    c.id,
    expected,
    s.user_id,
  );
  if (b.weapons !== undefined)
    sh.Weapons = weapons.flatMap((w) => Array(w.quantity).fill(w.id)).join(' , ');
  if (b.beliefs !== undefined) sh.Beliefs = beliefs.join(' , ');
  const writes = [authorization, definitionGuard];
  writes.push(
    stmt(
      db,
      'UPDATE characters SET sheet=?,version=version+1 WHERE id=? AND version=?',
      JSON.stringify(sh),
      c.id,
      expected,
    ),
  );
  if (b.weapons !== undefined) {
    writes.push(stmt(db, 'DELETE FROM character_weapons WHERE character_id=?', c.id));
    writes.push(
      stmt(
        db,
        "INSERT INTO character_weapons(character_id,weapon_id,quantity) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.quantity') FROM json_each(?)",
        c.id,
        JSON.stringify(weapons),
      ),
    );
  }
  writes.push(
    stmt(
      db,
      'INSERT INTO operations(id,actor_id,character_id,request,before_state,after_state,result_version,created_at) VALUES(?,?,?,?,?,?,?,?)',
      crypto.randomUUID(),
      s.user_id,
      c.id,
      JSON.stringify({ kind: 'loadout', weapons, beliefs }),
      c.state,
      c.state,
      expected + 1,
      Date.now(),
    ),
  );
  writes.push(stmt(db, 'DELETE FROM owner_checks WHERE id IN(?,?)', guardId, definitionsGuardId));
  await db.batch(writes);
  return { ok: true, version: expected + 1 };
}
