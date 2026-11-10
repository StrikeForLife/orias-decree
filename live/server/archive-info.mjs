import { fail } from './auth.mjs';
import { text } from './game.mjs';
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
const payload = (row) => ({ system_id: row.id, Name: row.name, Content: row.content });
export async function archiveInfo(db, includeArchived = false) {
  const { results } = await db
    .prepare(
      `SELECT * FROM archive_info ${includeArchived ? '' : 'WHERE archived=0'} ORDER BY position,id`,
    )
    .all();
  return includeArchived
    ? results.map((row) => ({
        kind: 'info',
        id: row.id,
        payload: payload(row),
        version: row.version,
        archived: row.archived,
      }))
    : results.map(payload);
}
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

/** Reuses the owner transaction/audit boundary; content is stored as plain text. */
export async function ownerInfo(db, actor, path, body, commit) {
  const id = text(body.id, 100);
  if (!/^[-\w]{1,100}$/.test(id)) fail(400, '資訊 ID 無效');
  const old = await stmt(db, 'SELECT * FROM archive_info WHERE id=?', id).first();
  if (old ? body.version !== old.version : body.version !== null)
    fail(409, '資訊已改變，請重新載入');
  const guardId = 'info:' + crypto.randomUUID();
  const guard = old
    ? stmt(
        db,
        'INSERT INTO owner_checks(id,ok) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM archive_info WHERE id=? AND version=? AND name=? AND content=? AND archived=?) THEN 1 ELSE 0 END',
        guardId,
        id,
        old.version,
        old.name,
        old.content,
        old.archived,
      )
    : stmt(
        db,
        'INSERT INTO owner_checks(id,ok) SELECT ?,CASE WHEN NOT EXISTS(SELECT 1 FROM archive_info WHERE id=?) THEN 1 ELSE 0 END',
        guardId,
        id,
      );
  let writes, after, action;
  if (path === '/api/owner/content') {
    if (old?.archived) fail(409, '請先復原此資訊');
    const p = body.payload;
    if (
      !p ||
      p.system_id !== id ||
      Object.keys(p).some((k) => !['system_id', 'Name', 'Content'].includes(k))
    )
      fail(400, '資訊欄位或 ID 無效');
    const name = text(p.Name, 200).trim(),
      content = text(p.Content, 80000);
    if (!name) fail(400, '請填寫資訊名稱');
    after = { system_id: id, Name: name, Content: content };
    writes = [
      old
        ? stmt(
            db,
            'UPDATE archive_info SET name=?,content=?,version=version+1 WHERE id=?',
            name,
            content,
            id,
          )
        : stmt(
            db,
            'INSERT INTO archive_info(id,name,content,position) VALUES(?,?,?,(SELECT COALESCE(MAX(position)+1,0) FROM archive_info))',
            id,
            name,
            content,
          ),
    ];
    action = old ? 'content.update' : 'content.create';
  } else {
    if (!old) fail(404, '資訊不存在');
    if (typeof body.archived !== 'boolean') fail(400, '刪除狀態無效');
    if (!!old.archived === body.archived) return response({ ok: true, version: old.version });
    writes = [
      stmt(
        db,
        'UPDATE archive_info SET archived=?,version=version+1 WHERE id=?',
        body.archived ? 1 : 0,
        id,
      ),
    ];
    after = { payload: payload(old), archived: body.archived };
    action = body.archived ? 'content.archive' : 'content.restore';
  }
  await commit(
    db,
    actor,
    [],
    [guard, ...writes, stmt(db, 'DELETE FROM owner_checks WHERE id=?', guardId)],
    action,
    'info:' + id,
    old ? { payload: payload(old), archived: !!old.archived } : null,
    after,
  );
  return response({ ok: true, id, version: old ? old.version + 1 : 0 }, old ? 200 : 201);
}
