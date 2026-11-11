import { fail } from './auth.mjs';
import { applyResource } from './game.mjs';
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
/** One guarded transaction restores the party within D1's per-request budget. */
export async function restParty(db, session, campaignId, operationId) {
  const { results: characters } = await stmt(
    db,
    'SELECT id,sheet,state,version FROM normalized_characters WHERE campaign_id=?',
    campaignId,
  ).all();
  const ids = characters.map((c) => operationId + ':' + c.id);
  if (ids.some((id) => id.length > 150)) fail(400, '長休操作 ID 過長');
  const existing = ids.length
    ? (
        await stmt(
          db,
          'SELECT * FROM operations WHERE id IN (SELECT value FROM json_each(?))',
          JSON.stringify(ids),
        ).all()
      ).results
    : [];
  const request = JSON.stringify({ kind: 'rest' }),
    updates = [];
  for (const character of characters) {
    const id = operationId + ':' + character.id,
      prior = existing.find((row) => row.id === id);
    if (prior) {
      if (
        prior.actor_id !== session.user_id ||
        prior.character_id !== character.id ||
        prior.request !== request
      )
        fail(409, '長休操作 ID 已被使用');
      continue;
    }
    updates.push({
      id: character.id,
      operationId: id,
      version: character.version,
      before: character.state,
      after: JSON.stringify(
        applyResource(JSON.parse(character.state), JSON.parse(character.sheet), { kind: 'rest' }),
      ),
    });
  }
  if (!updates.length) return { ok: true, count: characters.length };
  const guard = 'rest:' + crypto.randomUUID(),
    payload = JSON.stringify(updates);
  await db.batch([
    stmt(
      db,
      "INSERT INTO owner_checks(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM campaigns p JOIN access_grants a ON a.campaign_id=p.id WHERE p.id=? AND p.active=1 AND a.user_id=? AND a.role='dm') AND NOT EXISTS(SELECT 1 FROM json_each(?) r LEFT JOIN characters c ON c.id=json_extract(r.value,'$.id') WHERE c.id IS NULL OR c.campaign_id<>? OR c.version<>json_extract(r.value,'$.version') OR EXISTS(SELECT 1 FROM operations o WHERE o.id=json_extract(r.value,'$.operationId'))) THEN 1 ELSE 0 END",
      guard,
      campaignId,
      session.user_id,
      payload,
      campaignId,
    ),
    stmt(
      db,
      "INSERT INTO operations(id,actor_id,character_id,request,before_state,after_state,result_version,created_at) SELECT json_extract(value,'$.operationId'),?,json_extract(value,'$.id'),?,json_extract(value,'$.before'),json_extract(value,'$.after'),json_extract(value,'$.version')+1,? FROM json_each(?)",
      session.user_id,
      request,
      Date.now(),
      payload,
    ),
    stmt(
      db,
      "WITH recovered AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.after') after_state FROM json_each(?)) UPDATE characters SET state=(SELECT after_state FROM recovered WHERE recovered.id=characters.id),version=version+1 WHERE id IN (SELECT id FROM recovered)",
      payload,
    ),
    stmt(db, 'DELETE FROM owner_checks WHERE id=?', guard),
  ]);
  return { ok: true, count: characters.length };
}
