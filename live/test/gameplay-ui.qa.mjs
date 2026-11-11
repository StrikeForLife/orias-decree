/** Optional Playwright regression: installed Playwright + Chromium, no production data. */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { gameplayPreview } from './fixtures/gameplay-preview.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const output = new URL('../../.runtime/gameplay-ui/', import.meta.url);
await fs.mkdir(output, { recursive: true });
const fixture = await gameplayPreview();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const errors = [];
async function open(actor, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, ...options });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(fixture.origin + '/__qa/actor/' + actor);
  await page.waitForSelector('#refreshLive');
  return { context, page };
}
const capture = (page, name) =>
  page.screenshot({ path: new URL(name + '.png', output).pathname, fullPage: true });
try {
  const { context, page } = await open('owner');
  assert.deepEqual(await page.locator('#character option').allTextContents(), ['黎明行者']);
  await page.click('[data-page="隊伍"]');
  await page.click('[data-teammate="otherhero"]');
  assert(
    await page
      .locator('.team-sheet')
      .innerText()
      .then((t) => t.includes('遠行同伴')),
  );
  assert.equal(await page.locator('#content #inventory').count(), 0);
  await page.click('[data-page="角色"]');
  await page.evaluate(() => {
    window.__feedback = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      if (this.classList.contains('vitality-chamber')) window.__feedback.push('hp');
      if (this.classList.contains('will-chamber')) window.__feedback.push('will');
      return animate.apply(this, args);
    };
  });
  await page.click('[data-settle="0"]');
  await page.waitForFunction(
    () => window.ORIA.state.characters.hero.hp === 11 && window.__feedback.includes('hp'),
  );
  assert.equal(await page.locator('[data-settle]').count(), 0);
  await page.click('#pray');
  await page.waitForFunction(
    () => window.ORIA.state.characters.hero.will === 1 && document.querySelector('.prayer-spark'),
  );
  await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.target?.classList.contains('prayer-spark'))
      .forEach((a) => {
        a.pause();
        a.currentTime = 250;
      }),
  );
  await capture(page, 'prayer-and-character');
  await page.click('#editLoadout');
  await page.fill('[data-weapon-quantity="blade"]', '3');
  await page.click('[data-weapon-type="support"]');
  await page.click('[data-add-weapon="shield"]');
  await page.fill('[data-weapon-quantity="shield"]', '2');
  await page.click('[data-loadout-belief="other-faith"]');
  await page.click('#saveLoadout');
  await page.waitForFunction(() => !document.querySelector('#manageDialog').open);
  assert.equal(
    await page.locator('#content [data-weapon="blade"] .weapon-quantity').textContent(),
    '× 3',
  );
  await page.click('#editLoadout');
  assert.equal(await page.inputValue('[data-weapon-quantity="blade"]'), '3');
  await capture(page, 'weapon-and-belief-editor');
  await page.fill('[data-weapon-quantity="blade"]', '0');
  await page.click('#saveLoadout');
  await page.waitForFunction(() => !document.querySelector('#manageDialog').open);
  assert.equal(await page.locator('#content [data-weapon="blade"]').count(), 0);
  let releaseReload;
  const gate = new Promise((resolve) => (releaseReload = resolve));
  await page.route('**/api/bootstrap', async (route) => {
    await gate;
    await route.continue();
  });
  await page.click('#refreshLive');
  await page.waitForSelector('#reloadSpinner:not([hidden])');
  assert(await page.isDisabled('#refreshLive'));
  releaseReload();
  await page.waitForFunction(
    () => document.querySelector('#reloadStatus').textContent === '重新載入完成',
  );
  assert(await page.isHidden('#reloadSpinner'));
  await page.unroute('**/api/bootstrap');
  await page.route('**/api/bootstrap', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: '測試連線失敗' }),
    }),
  );
  await page.click('#refreshLive');
  await page.waitForFunction(() =>
    document.querySelector('#reloadStatus').textContent.includes('重新載入失敗'),
  );
  assert(!(await page.isDisabled('#refreshLive')));
  assert(await page.isHidden('#reloadSpinner'));
  await page.unroute('**/api/bootstrap');
  const tones = await page
    .locator('#content .attributes .ability')
    .evaluateAll((nodes) =>
      nodes.map((n) => getComputedStyle(n).getPropertyValue('--tone').trim()),
    );
  await page.click('#newCharacter');
  assert.deepEqual(
    await page
      .locator('#manageDialog .stat-rune')
      .evaluateAll((nodes) =>
        nodes.map((n) => getComputedStyle(n).getPropertyValue('--tone').trim()),
      ),
    tones,
  );
  await page.hover('[data-pick="option"]');
  await page.waitForSelector('#spellPreview:popover-open');
  assert((await page.locator('#spellPreview').innerText()).includes('第二段完整說明'));
  const preview = await page.locator('#spellPreview').boundingBox(),
    button = await page.locator('[data-pick="option"]').boundingBox();
  assert(preview.x < button.x);
  await capture(page, 'creation-stats-and-spell-preview');
  await page.focus('[data-pick="core"]');
  assert.equal(await page.getAttribute('[data-pick="core"]', 'aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  assert(await page.locator('#spellPreview').isHidden());
  assert(await page.locator('#manageDialog').evaluate((d) => d.open));
  await page.click('#manageDialog [aria-label="關閉"]');
  await page.click('[data-page="典籍"]');
  await page.click('[data-archive="冒險須知"]');
  assert.equal(await page.locator('.info-article').count(), 10);
  await page.fill('#infoSearch', '意志系統');
  assert.equal(await page.locator('.info-article').count(), 1);
  await page.click('.info-article summary');
  assert((await page.locator('.info-article').innerText()).includes('長休'));
  await capture(page, 'archive-info');
  await page.click('#ownerConsoleButton');
  await page.waitForSelector('#ownerConsole[open]');
  await page.click('[data-owner-kind="info"]');
  await page.click('[data-owner-record="17512122"]');
  const text = '可編輯的玩法資訊。\n\n<img src=x onerror=window.__injected=true>';
  await page.fill('[data-owner-field="Content"]', text);
  await page.click('#ownerContentForm button[type="submit"]');
  await page.waitForFunction(() =>
    document.querySelector('#ownerMessage').textContent.includes('內容已儲存'),
  );
  await capture(page, 'archive-info-manager');
  await page.click('#ownerClose');
  await page.click('[data-archive="冒險須知"]');
  await page.locator('.info-article').first().locator('summary').click();
  assert((await page.locator('.info-article').first().innerText()).includes('<img src=x'));
  assert.equal(await page.locator('.info-article img').count(), 0);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
  await context.close();
  const reader = await open('reader');
  assert.equal(await reader.page.locator('#character option').count(), 0);
  assert(await reader.page.isDisabled('#character'));
  assert(await reader.page.isHidden('#editLoadout'));
  await reader.page.click('[data-page="典籍"]');
  await reader.page.click('[data-archive="冒險須知"]');
  assert.equal(await reader.page.locator('.info-article').count(), 10);
  await reader.page.click('[data-page="隊伍"]');
  assert.equal(await reader.page.locator('[data-teammate]').count(), 2);
  await reader.context.close();
  const dm = await open('dm');
  assert.equal(await dm.page.locator('#character option').count(), 2);
  await dm.page.click('#adminPanel');
  await dm.page.fill('[data-resource-hp="hero"]', '-5');
  await dm.page.fill('[data-resource-will="hero"]', '7');
  await dm.page.click('[data-resource-save="hero"]');
  await dm.page.waitForFunction(
    () =>
      window.ORIA.state.characters.hero.hp === -5 && window.ORIA.state.characters.hero.will === 7,
  );
  await capture(dm.page, 'dm-resource-editor');
  await dm.context.close();
  const reduced = await open('owner', { reducedMotion: 'reduce' });
  await reduced.page.click('#pray');
  await reduced.page.waitForFunction(() => window.ORIA.state.characters.hero.will === 6);
  assert.equal(await reduced.page.locator('.prayer-spark').count(), 0);
  await reduced.context.close();
  fixture.db.raw.exec('UPDATE campaigns SET active=0');
  const empty = await open('reader');
  await empty.page.click('[data-page="隊伍"]');
  assert((await empty.page.locator('#content').innerText()).includes('目前沒有同行角色'));
  await empty.page.click('[data-page="典籍"]');
  await empty.page.click('[data-archive="冒險須知"]');
  assert.equal(await empty.page.locator('.info-article').count(), 10);
  await empty.context.close();
  assert.deepEqual(errors, []);
  console.log(
    'Browser QA passed: ownership, wounds, prayer sparks, weapon quantities, beliefs, reload states, creation colours/hover, info editor/XSS, DM adjustments and reduced motion.',
  );
  console.log('Screenshots: ' + output.pathname);
} finally {
  await browser.close();
  await fixture.close();
}
