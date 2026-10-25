import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildApp, buildHTML, replaceRegion } from '../scripts/frontend-build.mjs';

const read = (path) => fs.readFile(new URL(path, import.meta.url), 'utf8');

test('live build replaces offline storage and keeps every resource command connected', async () => {
  const app = buildApp(await read('../../dist/app.js'), {
    state: await read('../frontend/state.js'),
    notes: await read('../frontend/notes.js'),
    forms: await read('../frontend/character-forms.js'),
    motion: await read('../frontend/motion.js'),
  });
  assert(!app.includes("fetch('data.json')"));
  assert(!app.includes("fetch('background.json')"));
  assert(!app.includes('oria-playtest-v1'));
  assert(app.includes('async function commitResource('));
  assert(app.includes("$('#undo').onclick = undoResource"));
  assert(app.includes('queuePrivate(selected, key, e.target.value)'));
  assert(app.includes("import('./owner-console.js')"));
  for (const kind of ['damage', 'temp', 'pray', 'settle', 'stop', 'stabilize']) {
    assert(app.includes(`kind: '${kind}'`), `Missing live command: ${kind}`);
  }
  assert(app.includes('protectUI();'));
  assert(app.includes('renderGrowthPanel();'));
});

test('missing, duplicated or reversed adapter markers stop composition', () => {
  for (const source of [
    '',
    '// @state:start\noffline',
    '// @state:end\n// @state:start',
    '// @state:start\n// @state:start\n// @state:end',
    '// @state:start\n// @state:end\n// @state:end',
  ]) {
    assert.throws(() => replaceRegion(source, 'state', 'live'), /frontend region/);
  }
  assert.equal(
    replaceRegion('prefix\n// @state:start\r\noffline\r\n// @state:end\r\nsuffix', 'state', 'live'),
    'prefix\nlive\nsuffix',
  );
});

test('live HTML keeps content hidden until login and rejects missing bootstrap anchors', async () => {
  const source = await read('../../dist/index.html');
  const html = buildHTML(source);
  assert(html.includes('<main hidden>'));
  assert(html.includes('id="loginPanel"'));
  assert(html.includes('src="boot.js"'));
  assert(!html.includes('src="app.js"'));
  assert(html.includes('href="live.css"'));
  for (const anchor of ['<main>', 'src="app.js"', '</head>']) {
    assert.throws(() => buildHTML(source.replace(anchor, '')), /HTML anchor/);
  }
});
