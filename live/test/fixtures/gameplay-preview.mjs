/** Synthetic, isolated browser fixture. Never imported by the deployed Worker. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './api-fixture.mjs';
import { addCampaignDefinitions } from './campaign-definitions.mjs';
export async function gameplayPreview() {
  const { db, env, handler } = await setup();
  addCampaignDefinitions(db);
  db.raw.exec(
    "INSERT INTO site_owner VALUES(1,'owner',1); UPDATE users SET email=id||'@example.invalid',name=CASE id WHEN 'owner' THEN '測試典藏者' WHEN 'dm' THEN '測試 DM' ELSE '測試同行者' END; UPDATE campaigns SET name='霧港航路' WHERE id='active'; INSERT INTO character_spells(character_id,spell_id) VALUES('hero','core'); INSERT INTO character_weapons(character_id,weapon_id,quantity) VALUES('hero','blade',2)",
  );
  for (const [id, name] of [
    ['hero', '黎明行者'],
    ['otherhero', '遠行同伴'],
  ])
    db.raw
      .prepare(
        "UPDATE characters SET sheet=json_set(sheet,'$.\"Character Name\"',?,'$.Background','origin','$.Beliefs','faith') WHERE id=?",
      )
      .run(name, id);
  const state = JSON.parse(
    db.raw.prepare("SELECT state FROM characters WHERE id='hero'").get().state,
  );
  state.wounds = [4];
  db.raw.prepare("UPDATE characters SET state=? WHERE id='hero'").run(JSON.stringify(state));
  const publicDir = path.resolve(fileURLToPath(new URL('../../public/', import.meta.url)));
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };
  env.ASSETS = {
    async fetch(req) {
      const pathname = decodeURIComponent(new URL(req.url).pathname),
        file = path.resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(publicDir + path.sep)) return new Response('Not found', { status: 404 });
      try {
        return new Response(await fs.readFile(file), {
          headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    },
  };
  const server = http.createServer(async (req, res) => {
    try {
      const actor = new URL(req.url, env.APP_ORIGIN).pathname.match(
        /^\/__qa\/actor\/(owner|other|dm|reader)$/,
      )?.[1];
      if (actor) {
        res.writeHead(303, {
          Location: '/',
          'Set-Cookie':
            'oria_session=' +
            Buffer.from(actor).toString('hex').padEnd(64, '0') +
            '; Path=/; HttpOnly; SameSite=Strict',
        });
        res.end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(env.APP_ORIGIN + req.url, {
        method: req.method,
        headers: req.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      });
      const response = await handler(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end('Synthetic preview error');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  env.APP_ORIGIN = origin;
  return {
    origin,
    db,
    close: () =>
      new Promise((resolve) =>
        server.close(() => {
          db.close();
          resolve();
        }),
      ),
  };
}
