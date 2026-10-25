import test from 'node:test';
import assert from 'node:assert/strict';
import { productionConfig, checkMigrations, preflight } from '../../.github/scripts/production.mjs';

const settings = {
  workerName: 'oria-decree',
  databaseName: 'oria-decree',
  databaseId: '0e229d59-ccb3-4fc7-afc7-227a02488630',
  origin: 'https://oria.example',
  googleClientId: '123-abc.apps.googleusercontent.com',
};
const base = {
  name: 'placeholder',
  main: 'server/worker.mjs',
  assets: { directory: './public', binding: 'ASSETS' },
  compatibility_date: '2026-10-01',
  vars: {},
};
const account = 'a'.repeat(32);

test('production config replaces placeholder bindings while preserving code compatibility settings', () => {
  const c = productionConfig(base, settings, account);
  assert.equal(c.name, 'oria-decree');
  assert.equal(c.d1_databases[0].database_id, settings.databaseId);
  assert.equal(c.vars.APP_ORIGIN, settings.origin);
  assert.equal(c.account_id, account);
  assert.equal(c.compatibility_date, base.compatibility_date);
  assert(!Object.hasOwn(c.vars, 'OWNER_EMAIL'));
  assert.equal(base.name, 'placeholder');
});
test('invalid release layout, origin or account fails closed', () => {
  assert.throws(() => productionConfig(base, settings, ''), /ACCOUNT_ID/);
  assert.throws(
    () => productionConfig(base, { ...settings, origin: 'http://oria.example' }, account),
    /HTTPS/,
  );
  assert.throws(
    () => productionConfig({ ...base, main: 'other.mjs' }, settings, account),
    /layout/,
  );
});
test('schema gate rejects both pending migrations and incompatible rollback schemas', () => {
  assert.deepEqual(checkMigrations(['0001.sql', '0002.sql'], ['0002.sql', '0001.sql']), [
    '0001.sql',
    '0002.sql',
  ]);
  assert.throws(() => checkMigrations(['0001.sql'], ['0001.sql', '0002.sql']), /Pending: 0002.sql/);
  assert.throws(
    () => checkMigrations(['0001.sql', '0002.sql'], ['0001.sql']),
    /Unknown applied: 0002.sql/,
  );
});
test('preflight sends SELECT-only statements and checks an existing owner binding', async () => {
  const statements = [];
  const fake = async (url, request) => {
    assert(url.includes('/accounts/' + account + '/d1/database/' + settings.databaseId + '/query'));
    assert.equal(request.headers.Authorization, 'Bearer test-only');
    const sql = JSON.parse(request.body).sql;
    statements.push(sql);
    return Response.json({
      success: true,
      result: [
        {
          success: true,
          results: sql.includes('d1_migrations') ? [{ name: '0001.sql' }] : [{ total: 1 }],
        },
      ],
    });
  };
  const out = await preflight(
    productionConfig(base, settings, account),
    ['0001.sql'],
    'test-only',
    fake,
  );
  assert(out.ownerBindingPresent);
  assert.equal(statements.length, 2);
  assert(statements.every((s) => s.startsWith('SELECT ')));
});
test('preflight refuses absent credentials, rejected API responses and an unclaimed database', async () => {
  const c = productionConfig(base, settings, account);
  await assert.rejects(
    preflight(c, [], '', () => {
      throw Error('should not call');
    }),
    /API_TOKEN/,
  );
  await assert.rejects(
    preflight(c, [], 'token', async () => new Response('', { status: 403 })),
    /HTTP 403/,
  );
  const fake = async (_, req) =>
    Response.json({
      success: true,
      result: [
        {
          success: true,
          results: JSON.parse(req.body).sql.includes('d1_migrations') ? [] : [{ total: 0 }],
        },
      ],
    });
  await assert.rejects(preflight(c, [], 'token', fake), /owner/);
});
