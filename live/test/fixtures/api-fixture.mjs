import fs from 'node:fs/promises';
import { sqliteDB } from '../../scripts/sqlite-adapter.mjs';
import { createHandler } from '../../server/worker.mjs';
import { hash } from '../../server/auth.mjs';
const migrationFolder = new URL('../../migrations/', import.meta.url);
export const schema = (
  await Promise.all(
    (await fs.readdir(migrationFolder))
      .filter((n) => n.endsWith('.sql'))
      .sort()
      .map((n) => fs.readFile(new URL(n, migrationFolder), 'utf8')),
  )
).join('\n');
export async function setup() {
  const db = sqliteDB();
  db.raw.exec(schema);
  db.raw.exec("INSERT INTO campaigns(id,name,active) VALUES('active','Active',1),('old','Old',0);");
  for (const [id, email, role] of [
    ['owner', 'owner@gmail.com', 'player'],
    ['other', 'other@gmail.com', 'player'],
    ['dm', 'dm@gmail.com', 'dm'],
    ['reader', 'reader@gmail.com', null],
  ]) {
    db.raw.prepare('INSERT INTO users(id,google_sub,email) VALUES(?,?,?)').run(id, id, email);
    if (role)
      for (const campaign of ['active', 'old'])
        db.raw
          .prepare('INSERT INTO access_grants(id,email,user_id,campaign_id,role) VALUES(?,?,?,?,?)')
          .run(id + campaign, email, id, campaign, role);
    db.raw
      .prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)')
      .run(
        await hash(Buffer.from(id).toString('hex').padEnd(64, '0')),
        id,
        'csrf-' + id,
        Date.now() + 1000000,
      );
  }
  const sheet = {
    'Character Name': 'Hero',
    Level: '1',
    Class: 'ranger',
    School: 'wind',
    'Max Health': '15',
    'Max Willpower': '2',
    'Available Spell Slots': '4',
    Strength: '1',
    Dexterity: '1',
    Constitution: '1',
    Intelligence: '1',
    Wisdom: '1',
    Charisma: '1',
  };
  for (const [id, campaign, owner] of [
    ['hero', 'active', 'owner'],
    ['otherhero', 'active', 'other'],
    ['oldhero', 'old', 'owner'],
  ])
    db.raw
      .prepare(
        'INSERT INTO characters(id,campaign_id,owner_email,owner_user_id,sheet,state) VALUES(?,?,?,?,?,?)',
      )
      .run(
        id,
        campaign,
        owner + '@gmail.com',
        owner,
        JSON.stringify(sheet),
        JSON.stringify({
          hp: 15,
          temp: 2,
          will: 2,
          wounds: [],
          general: 'SECRET-' + id,
          inventory: 'PRIVATE-' + id,
        }),
      );
  const handler = createHandler(),
    env = {
      DB: db,
      APP_ORIGIN: 'https://oria.example',
      GOOGLE_CLIENT_ID: 'test-client',
      ASSETS: { fetch: () => new Response('asset') },
    };
  const request = async (actor, path, method = 'GET', body, extra = {}) => {
    const session = Buffer.from(actor).toString('hex').padEnd(64, '0');
    return handler(
      new Request(env.APP_ORIGIN + path, {
        method,
        headers: {
          Cookie: '__Host-oria_session=' + session,
          Origin: env.APP_ORIGIN,
          'X-CSRF-Token': 'csrf-' + actor,
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    );
  };
  return { db, request, env, handler };
}
