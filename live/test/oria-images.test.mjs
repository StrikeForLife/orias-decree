import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { BELIEF_KEYS } from '../../dist/lore-colours.mjs';

test('all Oria introductions resolve to a complete PNG; unknown beliefs have no portrait', async () => {
  const source = await fs.readFile(new URL('../../dist/app.js', import.meta.url), 'utf8');
  const detail = source.slice(
    source.indexOf('function beliefDetail('),
    source.indexOf('function beliefTile('),
  );
  for (const id of [...Object.keys(BELIEF_KEYS), 'unknown']) {
    let portrait;
    const element = {
      classList: { remove() {} },
      set innerHTML(html) {
        portrait = html;
      },
    };
    vm.runInNewContext(`${detail}\nbeliefDetail(id);`, {
      id,
      BELIEF_KEYS,
      find: () => ({ Name: '測試神祇 Test', Title: '測試尊稱' }),
      chineseName: () => '測試神祇',
      esc: (s) => s ?? '',
      $: () => element,
      detailSection: () => '',
      paintLore() {},
    });
    if (id === 'unknown') {
      assert(!portrait.includes('<img'));
      continue;
    }
    const path = `oria/${BELIEF_KEYS[id]}.png`;
    assert(portrait.includes(`src="${path}"`));
    assert(portrait.includes('alt="" aria-hidden="true"'));
    const png = await fs.readFile(new URL(`../../dist/${path}`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0);
  }
});
