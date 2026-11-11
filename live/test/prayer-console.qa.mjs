import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { gameplayPreview } from './fixtures/gameplay-preview.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const fixture = await gameplayPreview({ extraChoices: true });
fixture.db.raw.exec(
  "UPDATE characters SET sheet=json_set(sheet,'$.Beliefs','fb43faea , 368c14c1') WHERE id='hero'; UPDATE definitions SET payload=json_set(payload,'$.Quote','旅途中的自由，來自每一次選擇。','$.\"Belief Effect 1\"','呼求信仰，獲得庇護。','$.\"Belief Effect 2\"','回應意志的第二道祝福。') WHERE kind='beliefs'",
);
const out = new URL('../../.runtime/prayer-console/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const errors = [],
  dialogs = [];
async function open(actor, viewport = { width: 1500, height: 1000 }) {
  const context = await browser.newContext({ viewport }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    d.dismiss();
  });
  await page.goto(fixture.origin + '/__qa/actor/' + actor);
  await page.waitForSelector('#refreshLive');
  return { page, context };
}
const capture = (page, name) => page.screenshot({ path: new URL(name + '.png', out).pathname });
try {
  const { page, context } = await open('owner');
  await page.click('#pray');
  assert.equal(await page.locator('[data-prayer-belief]').count(), 2);
  assert.equal(await page.locator('.prayer-card img').count(), 2);
  assert((await page.locator('.prayer-quote').first().textContent()).includes('自由'));
  assert((await page.locator('.prayer-effect').first().textContent()).includes('庇護'));
  await page.click('[data-prayer-belief="fb43faea"]');
  assert((await page.locator('.prayer-card .prayer-spark').count()) > 0);
  await capture(page, 'prayer-cards');
  await page.click('#manageDialog [aria-label="關閉"]');
  assert.equal(fixture.db.raw.prepare('SELECT COUNT(*) n FROM operations').get().n, 0);
  await page.click('#pray');
  await page.click('[data-prayer-belief="368c14c1"]');
  await page.click('#confirmPrayer');
  await page.waitForSelector('#prayerDone:not([hidden])');
  assert.equal(await page.evaluate(() => window.ORIA.state.characters.hero.will), 1);
  assert.equal(
    JSON.parse(fixture.db.raw.prepare('SELECT request FROM operations').get().request).beliefId,
    '368c14c1',
  );
  await capture(page, 'prayer-complete');
  await page.click('#prayerDone');
  await page.route('**/api/characters/hero/resource', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.click('#pray');
  await page.click('[data-prayer-belief="fb43faea"]');
  await page.click('#confirmPrayer');
  await page.click('#manageDialog [aria-label="關閉"]');
  await page.click('#editLoadout');
  await page.waitForFunction(() => window.ORIA.permissions.hero.version === 2);
  assert.equal(await page.locator('#prayerStatus').count(), 0);
  assert(await page.locator('#manageDialog').evaluate((el) => el.open));
  await page.click('#manageDialog [aria-label="關閉"]');
  await page.unroute('**/api/characters/hero/resource');
  await page.click('#editLoadout');
  await page.click('[data-loadout-belief="368c14c1"]');
  await page.click('[data-loadout-belief="368c14c1"]');
  assert(
    (
      await page.locator('[data-loadout-belief="368c14c1"] .belief-choice-mark').textContent()
    ).includes('已選'),
  );
  await page.hover('[data-loadout-belief="368c14c1"]');
  const transform = await page.locator('[data-loadout-belief="368c14c1"] img').evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return { b: m.b, c: m.c };
  });
  assert.equal(transform.b, 0);
  assert.equal(transform.c, 0);
  await capture(page, 'chosen-vow');
  await page.click('#manageDialog [aria-label="關閉"]');
  await context.close();
  fixture.db.raw.exec(
    "UPDATE characters SET state=json_set(state,'$.hp',50,'$.will',8,'$.wounds',json('[4]')) WHERE id='hero'",
  );
  const dm = await open('dm');
  await dm.page.click('#adminPanel');
  assert.equal(await dm.page.locator('[data-dm-member]').count(), 2);
  assert.equal(await dm.page.getAttribute('[data-resource-hp="hero"]', 'max'), '15');
  assert.equal(await dm.page.getAttribute('[data-resource-will="hero"]', 'max'), '2');
  assert((await dm.page.locator('#dm-hp-value').textContent()).includes('50'));
  assert(await dm.page.isDisabled('#dmSaveResources'));
  await dm.page.fill('[data-level="hero"]', '4');
  await dm.page.fill('[data-resource-hp="hero"]', '10');
  await dm.page.click('[data-dm-member="otherhero"]');
  assert.equal(await dm.page.locator('[data-resource-hp="hero"]').count(), 0);
  await dm.page.click('[data-dm-member="hero"]');
  assert.equal(await dm.page.inputValue('[data-level="hero"]'), '4');
  assert.equal(await dm.page.inputValue('[data-resource-hp="hero"]'), '10');
  await dm.page.click('#dmSaveResources');
  await dm.page.waitForFunction(() => window.ORIA.state.characters.hero.hp === 10);
  assert.equal(await dm.page.inputValue('[data-level="hero"]'), '4');
  assert.equal(
    JSON.parse(fixture.db.raw.prepare("SELECT state FROM characters WHERE id='hero'").get().state)
      .will,
    8,
  );
  await dm.page.fill('[data-resource-will="hero"]', '2');
  await dm.page.click('#dmSaveResources');
  await dm.page.waitForFunction(() => window.ORIA.state.characters.hero.will === 2);
  await dm.page.click('#dmSaveSettings');
  await dm.page.waitForFunction(
    () => window.ORIA.data.character.find((c) => c.system_id === 'hero').Level === '4',
  );
  assert.equal(await dm.page.getAttribute('[data-resource-hp="hero"]', 'max'), '38');
  assert.equal(await dm.page.getAttribute('[data-resource-will="hero"]', 'max'), '1');
  assert.equal(await dm.page.evaluate(() => window.ORIA.state.characters.hero.will), 1);
  await dm.page.locator('#dmMemberTabs').scrollIntoViewIfNeeded();
  await dm.page.waitForFunction(
    () => document.querySelector('#dmMemberPanel').getAnimations().length === 0,
  );
  await capture(dm.page, 'dm-member-sliders');
  await dm.page.click('[data-dm-member="otherhero"]');
  await dm.page.fill('[data-resource-hp="otherhero"]', '3');
  await dm.page.fill('[data-resource-will="otherhero"]', '0');
  await dm.page.click('#dmSaveResources');
  await dm.page.waitForFunction(() => window.ORIA.state.characters.otherhero.hp === 3);
  await dm.page.click('#restAll');
  await dm.page.click('#confirmRest');
  await dm.page.waitForFunction(
    () =>
      window.ORIA.state.characters.hero.hp === 38 &&
      window.ORIA.state.characters.otherhero.hp === 15,
  );
  assert.equal(await dm.page.evaluate(() => window.ORIA.state.characters.hero.wounds.length), 0);
  assert.equal(await dm.page.evaluate(() => window.ORIA.state.characters.hero.temp), 2);
  await capture(dm.page, 'dm-team-rest');
  await dm.context.close();
  const mobile = await open('owner', { width: 390, height: 844 });
  await mobile.page.click('#pray');
  assert(
    await mobile.page
      .locator('#manageDialog')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await capture(mobile.page, 'mobile-prayer');
  await mobile.context.close();
  assert.deepEqual(dialogs, []);
  assert.deepEqual(errors, []);
  console.log(
    'Prayer/DM browser QA passed: cards/quotes/effects, cancel/commit, chosen belief, sparks, no tilt, member tabs/drafts, capped sliders, levels, full rest and mobile layout.',
  );
} finally {
  await browser.close();
  await fixture.close();
}
