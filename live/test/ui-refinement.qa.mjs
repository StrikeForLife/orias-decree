/** Optional real-browser checks for visual feedback and the campaign selection UI. */
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { gameplayPreview } from './fixtures/gameplay-preview.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const fixture = await gameplayPreview({ extraChoices: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const out = new URL('../../.runtime/ui-refinement/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const errors = [];
async function open(viewport = { width: 1500, height: 1000 }, options = {}) {
  const context = await browser.newContext({ viewport, ...options }),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(fixture.origin + '/__qa/actor/owner');
  await page.waitForSelector('#refreshLive');
  return { context, page };
}
const capture = (page, name) => page.screenshot({ path: new URL(name + '.png', out).pathname });
async function singleRail(page) {
  const layout = await page.locator('.adventure-toolbar').evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    buttons: [...el.querySelectorAll('button')]
      .filter((b) => !b.hidden)
      .map((b) => b.getBoundingClientRect().top),
  }));
  assert(layout.height < 75);
  assert(Math.max(...layout.buttons) - Math.min(...layout.buttons) < 4);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
try {
  const { context, page } = await open();
  // Keep the real Worker and D1-style trigger metadata; add network latency to
  // check that feedback starts on the confirmed response after the final render.
  await page.route('**/api/characters/*/resource', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await singleRail(page);
  await capture(page, 'command-rail');
  // Observe actual computed animation frames, not just calls to Element.animate.
  await page.fill('#damage', '6');
  await page.click('#hit');
  await page.waitForFunction(
    () => document.querySelector('.vitality-chamber').getAnimations().length > 0,
  );
  const shake = await page.locator('.vitality-chamber').evaluate((el) => {
    const animation = el.getAnimations()[0];
    animation.pause();
    const samples = [40, 70, 100, 140, 200, 280, 380].map((time) => {
      animation.currentTime = time;
      return { time, x: new DOMMatrix(getComputedStyle(el).transform).m41 };
    });
    const strongest = samples.sort((a, b) => Math.abs(b.x) - Math.abs(a.x))[0];
    animation.currentTime = strongest.time;
    return { x: strongest.x, connected: el.isConnected };
  });
  assert(shake.connected);
  assert(Math.abs(shake.x) > 5);
  await capture(page, 'health-shake');
  await page.click('#pray');
  await page.waitForFunction(
    () => window.ORIA.state.characters.hero.will === 1 && document.querySelector('.prayer-spark'),
  );
  const sparks = await page.locator('.prayer-spark').evaluateAll((nodes) =>
    nodes.map((el) => {
      const a = el.getAnimations()[0];
      a.pause();
      a.currentTime = 650;
      const r = el.getBoundingClientRect(),
        clip = document.querySelector('#status').getBoundingClientRect();
      return {
        opacity: Number(getComputedStyle(el).opacity),
        size: parseFloat(getComputedStyle(el).fontSize),
        visible: r.top < Math.min(innerHeight, clip.bottom) && r.bottom > Math.max(0, clip.top),
        connected: el.isConnected,
      };
    }),
  );
  assert(
    sparks.filter((s) => s.visible && s.opacity > 0.5 && s.size >= 20 && s.connected).length >= 8,
  );
  await page.locator('.prayer-halo').evaluate((el) => {
    const a = el.getAnimations()[0];
    a.pause();
    a.currentTime = 450;
  });
  await capture(page, 'prayer-sparks');
  await page.locator('[data-settle="0"]').scrollIntoViewIfNeeded();
  const resourceScroll = await page.locator('#status').evaluate((el) => el.scrollTop);
  await page.click('[data-settle="0"]');
  await page.waitForFunction(
    () => window.ORIA.state.characters.hero.hp === 9 && !document.querySelector('#hit').disabled,
  );
  const scrollAfter = await page
    .locator('#status')
    .evaluate((el) => ({ value: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  assert(Math.abs(scrollAfter.value - Math.min(resourceScroll, scrollAfter.max)) <= 1);
  await page.click('#editLoadout');
  await page.click('[data-weapon-type="heavy"]');
  await page.click('[data-add-weapon="greatsword"]');
  await page.click('[data-add-weapon="greatsword"]');
  await page.fill('[data-weapon-quantity="greatsword"]', '3');
  await page.click('[data-weapon-type="support"]');
  await page.click('[data-add-weapon="shield"]');
  assert.equal(await page.inputValue('[data-weapon-quantity="greatsword"]'), '3');
  await page.focus('[data-weapon-type="support"]');
  await page.keyboard.press('Home');
  assert.equal(await page.getAttribute('[data-weapon-type="main"]', 'aria-selected'), 'true');
  await capture(page, 'weapon-ledger');
  await page.fill('[data-weapon-quantity="blade"]', '');
  await page.click('#saveLoadout');
  assert((await page.locator('#manageMessage').textContent()).includes('有效'));
  await page.fill('[data-weapon-quantity="blade"]', '2');
  await page.click('[data-loadout-belief="fb43faea"]');
  await page.click('[data-loadout-belief="368c14c1"]');
  assert.equal(await page.getAttribute('[data-loadout-belief="fb43faea"]', 'aria-pressed'), 'true');
  assert.equal(await page.locator('[data-chosen-belief]').count(), 3);
  await page.locator('[data-loadout-belief="fb43faea"] img').scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.belief-choice-portrait')].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  );
  await capture(page, 'belief-vows');
  await page.click('#saveLoadout');
  await page.waitForFunction(() => !document.querySelector('#manageDialog').open);
  assert.equal(
    fixture.db.raw
      .prepare(
        "SELECT quantity FROM character_weapons WHERE character_id='hero' AND weapon_id='greatsword'",
      )
      .get().quantity,
    3,
  );
  assert(
    JSON.parse(
      fixture.db.raw.prepare("SELECT sheet FROM characters WHERE id='hero'").get().sheet,
    ).Beliefs.includes('fb43faea'),
  );
  await page.click('#editLoadout');
  assert.equal(await page.inputValue('[data-weapon-quantity="greatsword"]'), '3');
  await page.click('[data-remove-weapon="greatsword"]');
  await page.click('[data-loadout-belief="fb43faea"]');
  assert.equal(await page.locator('[data-chosen-belief="fb43faea"]').count(), 0);
  await page.click('#saveLoadout');
  await page.waitForFunction(() => !document.querySelector('#manageDialog').open);
  fixture.db.raw.exec("UPDATE characters SET edit_spells=1 WHERE id='hero'");
  await page.click('#refreshLive');
  await page.waitForFunction(() => window.ORIA.permissions.hero.editSpells);
  await page.click('#reselectCharacter');
  assert(
    await page.locator('#reClass input').evaluateAll((nodes) => nodes.every((n) => n.disabled)),
  );
  assert(
    await page.locator('#reSchool input').evaluateAll((nodes) => nodes.every((n) => n.disabled)),
  );
  assert.equal(await page.locator('#reClass input:checked').inputValue(), 'ranger');
  await page.click('#manageDialog [aria-label="關閉"]');
  // Single-choice cards must update the actual API payload and eligible spells.
  await page.click('#newCharacter');
  assert.equal(await page.locator('#manageDialog select').count(), 0);
  await page
    .locator('#createClass label')
    .filter({ has: page.locator('[value="soldier"]') })
    .click();
  assert.equal(await page.locator('#createSchool input:checked').inputValue(), 'iron');
  assert.equal(await page.locator('[data-pick="iron-core"]').count(), 1);
  assert.equal(await page.locator('[data-pick="option"]').count(), 0);
  await page
    .locator('#createClass label')
    .filter({ has: page.locator('[value="ranger"]') })
    .click();
  await page
    .locator('#createSchool label')
    .filter({ has: page.locator('[value="tide"]') })
    .click();
  await page
    .locator('#createBackground label')
    .filter({ has: page.locator('[value="harbor"]') })
    .click();
  assert.equal(await page.locator('#createClass input:checked').count(), 1);
  assert.equal(await page.locator('#createSchool input:checked').count(), 1);
  assert.equal(await page.locator('#createBackground input:checked').count(), 1);
  await page.focus('#createBackground [value="harbor"]');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#createBackground input:checked').inputValue(), 'forest');
  await page
    .locator('#createBackground label')
    .filter({ has: page.locator('[value="harbor"]') })
    .click();
  await page.locator('#createClass').scrollIntoViewIfNeeded();
  await capture(page, 'creation-choices');
  await page.fill('#createName', '霧海尋路者');
  for (const [key, value] of [
    ['Strength', 3],
    ['Dexterity', 3],
    ['Constitution', 3],
    ['Intelligence', 1],
  ]) {
    const slider = page.locator(`[data-createattr="${key}"]`);
    await slider.focus();
    await slider.press('Home');
    for (let n = -3; n < value; n++) await slider.press('ArrowRight');
  }
  assert(!(await page.isDisabled('#createSubmit')));
  await page.click('#createSubmit');
  await page.waitForFunction(() => !document.querySelector('#manageDialog').open);
  const created = JSON.parse(
    fixture.db.raw
      .prepare(
        "SELECT sheet FROM characters WHERE json_extract(sheet,'$.\"Character Name\"')='霧海尋路者'",
      )
      .get().sheet,
  );
  assert.equal(created.Class, 'ranger');
  assert.equal(created.School, 'tide');
  assert.equal(created.Background, 'harbor');
  assert.equal(
    fixture.db.raw
      .prepare(
        "SELECT COUNT(*) n FROM character_spells s JOIN characters c ON c.id=s.character_id WHERE json_extract(c.sheet,'$.\"Character Name\"')='霧海尋路者' AND s.spell_id='tide-core'",
      )
      .get().n,
    1,
  );
  // A last will point still produces full-brightness sparks even though prayer disables.
  await page.click('#character');
  await page.selectOption('#character', 'hero');
  await page.click('#pray');
  await page.waitForFunction(
    () => window.ORIA.state.characters.hero.will === 0 && document.querySelector('.prayer-spark'),
  );
  assert(await page.isDisabled('#pray'));
  assert(
    await page
      .locator('.prayer-spark')
      .first()
      .evaluate((el) => !el.closest('button:disabled')),
  );
  fixture.db.raw.exec(
    "UPDATE characters SET state=json_set(state,'$.will',1),version=version+1 WHERE id='hero'",
  );
  await page.click('#refreshLive');
  await page.waitForFunction(() => window.ORIA.state.characters.hero.will === 1);
  await page.route('**/api/characters/hero/resource', async (route) => {
    await route.fetch(); // Server applies once; the client receives an uncertain failure.
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: '測試回應中斷' }),
    });
  });
  await page.click('#pray');
  await page.waitForSelector('#retrySave:not([hidden])');
  assert.equal(await page.locator('.prayer-spark').count(), 0);
  await page.unroute('**/api/characters/hero/resource');
  await page.click('#retrySave');
  await page.waitForFunction(() => window.ORIA.state.characters.hero.will === 0);
  assert.equal(await page.locator('.prayer-spark').count(), 0);
  await context.close();
  const mobile = await open({ width: 390, height: 844 });
  await singleRail(mobile.page);
  await mobile.page.click('#editLoadout');
  await mobile.page.click('[data-weapon-type="heavy"]');
  await capture(mobile.page, 'mobile-weapons');
  assert(
    await mobile.page
      .locator('#manageDialog')
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await mobile.page.locator('[data-loadout-belief="368c14c1"]').scrollIntoViewIfNeeded();
  await capture(mobile.page, 'mobile-beliefs');
  await mobile.context.close();
  const reduced = await open({ width: 1000, height: 800 }, { reducedMotion: 'reduce' });
  const beforeReduced = await reduced.page.evaluate(() => window.ORIA.state.characters.hero.hp);
  await reduced.page.fill('#damage', '1');
  await reduced.page.click('#hit');
  await reduced.page.waitForFunction(
    (expected) =>
      window.ORIA.state.characters.hero.hp === expected && !document.querySelector('#hit').disabled,
    beforeReduced - 1,
  );
  assert.equal(
    await reduced.page.locator('.vitality-chamber').evaluate((el) => el.getAnimations().length),
    0,
  );
  await reduced.context.close();
  assert.deepEqual(errors, []);
  console.log(
    'UI refinement QA passed: visible shake/sparks, one-row toolbar, selection payloads/keyboard, tabbed quantities, portraits/vows, mobile overflow and reduced motion.',
  );
  console.log('Screenshots: ' + out.pathname);
} finally {
  await browser.close();
  await fixture.close();
}
