/** Synthetic, isolated browser fixture. Never imported by the deployed Worker. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './api-fixture.mjs';
import { addCampaignDefinitions } from './campaign-definitions.mjs';
export async function gameplayPreview({ extraChoices = false } = {}) {
  const { db, env, handler } = await setup();
  addCampaignDefinitions(db);
  if (extraChoices) {
    for (const [kind, id, payload] of [
      [
        'class',
        'soldier',
        {
          'Class Name (Chinese)': '野戰兵',
          'Short Desc': '戰場上的堅定守護者',
          'Class Desc': '以紀律、兵器與戰術守護同行者。',
        },
      ],
      [
        'school',
        'tide',
        {
          'School Name (Chinese)': '潮汐道',
          Class: 'ranger',
          Belief: 'fb43faea',
          'Main Spell': 'tide-core',
          Title: '以潮聲回應世界',
          Desc: '潮來潮往，皆為旅途的一部分。',
        },
      ],
      [
        'school',
        'iron',
        {
          'School Name (Chinese)': '鐵誓道',
          Class: 'soldier',
          'Main Spell': 'iron-core',
          Title: '不破之誓',
          Desc: '以堅定意志鑄成前線。',
        },
      ],
      ['spell', 'tide-core', { 'Spell Name (Chinese)': '潮聲迴響', School: 'tide' }],
      ['spell', 'iron-core', { 'Spell Name (Chinese)': '鐵壁', School: 'iron' }],
      [
        'background',
        'harbor',
        {
          Name: '霧港旅人',
          'Main Branch': '厄特彌姆',
          Desc: '你曾穿過迷霧與商船交錯的港口，沿著海岸展開旅程。',
        },
      ],
      [
        'background',
        'forest',
        { Name: '林間守望', 'Main Branch': '澤塔爾', Desc: '你在古林中學會聆聽大地的聲音。' },
      ],
      [
        'weapon',
        'greatsword',
        {
          'Weapon Name': '重劍',
          'Weapon Type': '重型武器',
          Available: true,
          Damage: '2d6',
          Effect: '雙手持握，迎擊強敵。',
        },
      ],
      [
        'weapon',
        'dagger',
        { 'Weapon Name': '短匕', 'Weapon Type': '副武器', Available: true, Damage: '1d4' },
      ],
      [
        'beliefs',
        'fb43faea',
        { Name: '自由', Title: '無拘之翼', Desc: '在選擇與旅途中尋找自身的道路。', Enable: true },
      ],
      [
        'beliefs',
        '368c14c1',
        {
          Name: '知識',
          Title: '永不熄滅的明燈',
          Desc: '追尋世界深處尚未揭示的答案。',
          Enable: true,
        },
      ],
    ])
      db.raw
        .prepare('INSERT INTO definitions(kind,id,payload) VALUES(?,?,?)')
        .run(kind, id, JSON.stringify({ system_id: id, ...payload }));
    db.raw.exec(
      "UPDATE definitions SET payload=json_set(payload,'$.\"Short Desc\"','荒野中的引路人','$.\"Class Desc\"','循著自然的痕跡，為同行者開拓前路。') WHERE kind='class' AND id='ranger'; UPDATE definitions SET payload=json_set(payload,'$.Title','追隨自由之風','$.Desc','在流動的風中尋找屬於自己的方向。','$.Belief','fb43faea') WHERE kind='school' AND id='wind'",
    );
  }
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
