/**
 * A single guided walk through One Life with seed 777, capturing a screenshot
 * of every major surface into e2e/__screenshots__/<project>/. Both projects
 * (iphone-light / iphone-dark) run the same walk; the theme stays on 'auto' so
 * each project's colorScheme picks its own palette.
 */

import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

import { ageYears, closeSheet, resolveEventCards } from './helpers';

const SEED = 777;

/** Where a named capture lands for the current project (cwd is the repo root). */
function shotPath(testInfo: TestInfo, name: string): string {
  return `e2e/__screenshots__/${testInfo.project.name}/${name}.png`;
}

/** Captures the viewport under a stable, ordered name. */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: shotPath(testInfo, name) });
}

/** Opens one tab's sheet, screenshots it and closes it again. */
async function shootTabSheet(
  page: Page,
  testInfo: TestInfo,
  tabId: string,
  name: string,
): Promise<void> {
  await page.getByTestId(`tab-${tabId}`).click();
  await expect(page.getByTestId(`sheet-${tabId}`)).toBeVisible();
  await shot(page, testInfo, name);
  await closeSheet(page, tabId);
}

test('walks the whole app capturing screenshots', async ({ page }, testInfo) => {
  test.setTimeout(300000);

  // 01 — the save slots.
  await page.goto(`/?seed=${String(SEED)}`);
  await expect(page.getByTestId('screen-slots')).toBeVisible();
  await shot(page, testInfo, '01-slots');

  // Reduce motion up front so no capture catches a spring mid-flight.
  await page.getByTestId('slots-settings').click();
  const slotsSettings = page.getByTestId('sheet-settings');
  await expect(slotsSettings).toBeVisible();
  await slotsSettings.getByTestId('settings-reduce-motion').click();
  await closeSheet(page, 'settings');

  // 02 — character creation.
  await page.getByTestId('slot-row-1').click();
  await expect(page.getByTestId('screen-create')).toBeVisible();
  await shot(page, testInfo, '02-create');

  // 03 — a newborn life.
  await page.getByTestId('create-start').click();
  await expect(page.getByTestId('screen-life')).toBeVisible();
  await shot(page, testInfo, '03-life-young');

  // 04 — an event card, if one comes up within 40 years; skipped gracefully.
  const eventSheet = page.getByTestId('sheet-event');
  const death = page.getByTestId('screen-death');
  for (let i = 0; i < 40; i += 1) {
    if ((await eventSheet.isVisible()) || (await death.isVisible())) {
      break;
    }
    try {
      await page.getByTestId('age-button').click({ timeout: 2000 });
    } catch {
      // A sheet slid over the button mid-click; the next pass sees it.
    }
    try {
      await eventSheet.waitFor({ state: 'visible', timeout: 250 });
    } catch {
      // No card this year.
    }
  }
  if (await eventSheet.isVisible()) {
    await shot(page, testInfo, '04-event');
    await resolveEventCards(page);
  }

  // A freak early death ends the walk with just the obituary capture.
  if (await death.isVisible()) {
    await shot(page, testInfo, '12-death');
    return;
  }

  // 05-08 — the four plain tab sheets.
  await shootTabSheet(page, testInfo, 'occupation', '05-sheet-occupation');
  await shootTabSheet(page, testInfo, 'assets', '06-sheet-assets');
  await shootTabSheet(page, testInfo, 'relationships', '07-sheet-relationships');
  await shootTabSheet(page, testInfo, 'activities', '08-sheet-activities');

  // 09-11 — the More sheet and the two sheets that open from it.
  await page.getByTestId('tab-more').click();
  const moreSheet = page.getByTestId('sheet-more');
  await expect(moreSheet).toBeVisible();
  await shot(page, testInfo, '09-sheet-more');

  await moreSheet.getByTestId('more-achievements').click();
  await expect(page.getByTestId('sheet-achievements')).toBeVisible();
  await shot(page, testInfo, '10-sheet-achievements');
  await closeSheet(page, 'achievements');

  await moreSheet.getByTestId('more-settings').click();
  await expect(page.getByTestId('sheet-settings')).toBeVisible();
  await shot(page, testInfo, '11-sheet-settings');
  await closeSheet(page, 'settings');
  await closeSheet(page, 'more');

  // The casino sheet has no tab of its own, so it gets no capture here.

  // Reach adulthood, then age the life all the way out. 12 — the obituary.
  await ageYears(page, 21);
  await ageYears(page, 130);
  await expect(death).toBeVisible();
  await expect(page.getByTestId('death-cause')).not.toBeEmpty();
  await shot(page, testInfo, '12-death');
});
