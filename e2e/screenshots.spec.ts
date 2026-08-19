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

/** Every capture a complete walk produces, in order. */
const EXPECTED_SHOTS = [
  '01-slots',
  '02-create',
  '03-life-young',
  '04-event',
  '05-sheet-occupation',
  '06-sheet-assets',
  '07-sheet-relationships',
  '08-sheet-activities',
  '09-sheet-more',
  '10-sheet-achievements',
  '11-sheet-settings',
  '12-death',
];

/**
 * What this run actually wrote. The set is only useful whole, and a gap is
 * otherwise invisible on disk: `e2e/__screenshots__/` is gitignored but never
 * cleaned, so a PNG left by an earlier run stands in for one this run skipped.
 * The single test below clears this before it starts walking.
 */
const captured = new Set<string>();

/** Where a named capture lands for the current project (cwd is the repo root). */
function shotPath(testInfo: TestInfo, name: string): string {
  return `e2e/__screenshots__/${testInfo.project.name}/${name}.png`;
}

/** Captures the viewport under a stable, ordered name. */
async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: shotPath(testInfo, name) });
  captured.add(name);
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
  captured.clear();

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

  // 04 — the first event card of the life, hunted for up to 40 years. A hunt
  // that turns up nothing leaves the set short, which the check at the end names.
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

  /* A freak early death ends the walk here: the tab bar and the More stack go
     with `LifeScreen`, so 05-11 can never be captured. Seed 777 survives the
     hunt today, but any content change that shifts its draws can flip that, so
     capture the obituary and mark the run skipped: a third of a set reporting
     as a pass is how a design review ends up shipping last week's PNGs. */
  if (await death.isVisible()) {
    await shot(page, testInfo, '12-death');
    test.skip(true, `seed ${String(SEED)} died before adulthood; capture set incomplete`);
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

  // The walk is a deliverable, not a smoke test: it passes only with the set whole.
  const missing = EXPECTED_SHOTS.filter((name) => !captured.has(name));
  expect(missing, 'captures this walk never took').toEqual([]);
});
