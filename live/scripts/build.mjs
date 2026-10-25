import fs from 'node:fs/promises';
import { buildApp, buildHTML } from './frontend-build.mjs';

const publicDir = new URL('../public/', import.meta.url);
const read = (path) => fs.readFile(new URL(path, import.meta.url), 'utf8');

// Validate composition before writing assets; a missing adapter must stop the build.
const app = buildApp(await read('../../dist/app.js'), {
  state: await read('../frontend/state.js'),
  notes: await read('../frontend/notes.js'),
  forms: await read('../frontend/character-forms.js'),
  motion: await read('../frontend/motion.js'),
});
const html = buildHTML(await read('../../dist/index.html'));

await fs.mkdir(publicDir, { recursive: true });
await fs.writeFile(new URL('app.js', publicDir), app);
await fs.writeFile(new URL('index.html', publicDir), html);

const assets = {
  'style.css': '../../dist/style.css',
  'lore-colours.mjs': '../../dist/lore-colours.mjs',
  'rules.mjs': '../../dist/rules.mjs',
  'boot.js': '../frontend/boot.js',
  'api.js': '../frontend/api.js',
  'live.css': '../frontend/live.css',
  'owner-console.js': '../frontend/owner-console.js',
  'owner-console.css': '../frontend/owner-console.css',
};
for (const [name, source] of Object.entries(assets)) {
  await fs.copyFile(new URL(source, import.meta.url), new URL(name, publicDir));
}
await fs.cp(new URL('../../dist/patterns/', import.meta.url), new URL('patterns/', publicDir), {
  recursive: true,
});

// Explicit allowlist: never ship snapshots, ownership emails or deployment credentials.
const allowed = new Set(['app.js', 'index.html', 'patterns', ...Object.keys(assets)]);
for (const file of await fs.readdir(publicDir)) {
  if (!allowed.has(file)) {
    await fs.rm(new URL(file, publicDir), { recursive: true, force: true });
  }
}
console.log('Built protected frontend without source snapshots.');
