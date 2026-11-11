/** Drive the in-page prayer cards; never accept a browser confirmation dialog. */
export async function startPrayer(page, beliefId, waitForSave = true) {
  await page.click('#pray');
  const card =
    beliefId === undefined
      ? page.locator('[data-prayer-belief]').first()
      : page.locator(`[data-prayer-belief="${beliefId}"]`);
  await card.click();
  await page.click('#confirmPrayer');
  if (waitForSave) await page.waitForSelector('#prayerDone:not([hidden])');
}
export async function finishPrayer(page) {
  await page.waitForSelector('#prayerDone:not([hidden])');
  await page.click('#prayerDone');
}
