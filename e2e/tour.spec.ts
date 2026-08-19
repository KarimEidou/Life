/**
 * Deep screenshot tour: walks a whole life capturing every reachable sheet and
 * state along the way. Slow by design, so it only runs when asked for:
 * `TOUR=1 npx playwright test e2e/tour.spec.ts`.
 */

import { test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

import { ageYears, closeSheet, resolveEventCards, startLife } from './helpers';

// Playwright runs this on node, but tsconfig.tools.json has no @types/node, so
// the opt-in switch reads the global structurally instead of naming `process`.
type NodeGlobal = { process?: { env?: Record<string, string | undefined> } };
const TOUR_ENABLED = (globalThis as NodeGlobal).process?.env?.TOUR === '1';

const SEED = 987654;

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({
    path: `e2e/__screenshots__/${testInfo.project.name}/${name}.png`,
  });
}

/**
 * Ends the tour on the death screen. `LifeScreen` — and with it the tab bar and
 * the whole More stack — is unmounted the moment the death screen takes over,
 * so every `tab-*` click below waits for an element that can never appear:
 * Playwright's default `actionTimeout` is 0 and playwright.config.ts sets none,
 * so a single missing tab spends the full 300 s budget and then blames the
 * locator instead of the death. Skipping rather than returning keeps a tour
 * that captured a fraction of its shots from reporting as a pass, and keeps the
 * obituary from being filed under a live-life name.
 */
async function bailIfDead(page: Page, testInfo: TestInfo): Promise<void> {
  if (!(await page.getByTestId('screen-death').isVisible())) {
    return;
  }
  await shot(page, testInfo, 'tour-17-death');
  test.skip(true, `seed ${String(SEED)} died mid-tour; the later captures are unreachable`);
}

async function openFromMore(page: Page, rowId: string, sheetId: string): Promise<boolean> {
  await page.getByTestId('tab-more').click();
  const more = page.getByTestId('sheet-more');
  await more.waitFor({ state: 'visible', timeout: 4000 });
  const row = more.getByTestId(rowId);
  if (!(await row.isVisible())) {
    await closeSheet(page, 'more');
    return false;
  }
  await row.click();
  await page.getByTestId(`sheet-${sheetId}`).waitFor({ state: 'visible', timeout: 4000 });
  return true;
}

async function closeMoreStack(page: Page, sheetId: string): Promise<void> {
  await closeSheet(page, sheetId);
  await closeSheet(page, 'more');
}

async function ageUntilEvent(page: Page, testInfo: TestInfo, name: string, cap: number): Promise<void> {
  const sheet = page.getByTestId('sheet-event');
  for (let i = 0; i < cap; i += 1) {
    if (await page.getByTestId('screen-death').isVisible()) {
      return;
    }
    if (await sheet.isVisible()) {
      await shot(page, testInfo, name);
      await resolveEventCards(page);
      return;
    }
    try {
      await page.getByTestId('age-button').click({ timeout: 4000 });
    } catch {
      // A sheet slid over the button; the next pass handles it.
    }
  }
}

test('grand tour', async ({ page }, testInfo) => {
  test.skip(!TOUR_ENABLED, 'opt-in: TOUR=1 npx playwright test e2e/tour.spec.ts');
  test.setTimeout(300_000);

  await startLife(page, SEED, {
    firstName: 'Robin',
    lastName: 'Miller',
    gender: 'female',
    countryId: 'us',
  });

  // Childhood.
  await ageYears(page, 8);
  await bailIfDead(page, testInfo);
  await shot(page, testInfo, 'tour-01-life-child');
  await ageUntilEvent(page, testInfo, 'tour-02-event-card', 12);

  // Teen: education sheet while enrolled.
  await ageYears(page, 4);
  await bailIfDead(page, testInfo);
  if (await openFromMore(page, 'more-education', 'education')) {
    await shot(page, testInfo, 'tour-03-education');
    await closeMoreStack(page, 'education');
  }
  await shot(page, testInfo, 'tour-04-life-teen');

  // Adult: try for a job, then tour every money-and-vice sheet.
  await ageYears(page, 8);
  await bailIfDead(page, testInfo);
  await page.getByTestId('tab-occupation').click();
  const occupation = page.getByTestId('sheet-occupation');
  await occupation.waitFor({ state: 'visible', timeout: 4000 });
  await shot(page, testInfo, 'tour-05-occupation');
  const firstJob = occupation.locator('[data-testid^="job-row-"]').first();
  if (await firstJob.isVisible()) {
    await firstJob.click();
  }
  await closeSheet(page, 'occupation');

  if (await openFromMore(page, 'more-finance', 'finance')) {
    await shot(page, testInfo, 'tour-06-finance');
    await closeMoreStack(page, 'finance');
  }
  if (await openFromMore(page, 'more-health', 'health')) {
    await shot(page, testInfo, 'tour-07-health');
    await closeMoreStack(page, 'health');
  }
  if (await openFromMore(page, 'more-crime', 'crime')) {
    await shot(page, testInfo, 'tour-08-crime');
    await closeMoreStack(page, 'crime');
  }

  // Casino: bet form, then a live or settled hand.
  if (await openFromMore(page, 'more-casino', 'casino')) {
    await shot(page, testInfo, 'tour-09-casino-menu');
    const casino = page.getByTestId('sheet-casino');
    if (await casino.getByTestId('casino-deal').isVisible()) {
      await casino.getByTestId('casino-bet-50').click();
      await casino.getByTestId('casino-deal').click();
      await shot(page, testInfo, 'tour-10-casino-hand');
      if (await casino.getByTestId('casino-stand').isVisible()) {
        await casino.getByTestId('casino-stand').click();
        await shot(page, testInfo, 'tour-11-casino-result');
      }
    }
    await closeMoreStack(page, 'casino');
  }

  // People. Every section re-checks rather than trusting the last age-up: a
  // sheet action can end a life with no year passing, since `runInteraction`
  // and `commitCrime` settle a death their effects marked.
  await bailIfDead(page, testInfo);
  await page.getByTestId('tab-relationships').click();
  const relationships = page.getByTestId('sheet-relationships');
  await relationships.waitFor({ state: 'visible', timeout: 4000 });
  await shot(page, testInfo, 'tour-12-relationships');
  const firstPerson = relationships.locator('[data-testid^="person-row-"]').first();
  if (await firstPerson.isVisible()) {
    await firstPerson.click();
    await page.getByTestId('sheet-person').waitFor({ state: 'visible', timeout: 4000 });
    await shot(page, testInfo, 'tour-13-person');
    await closeSheet(page, 'person');
  }
  await closeSheet(page, 'relationships');

  // Activities and assets in adulthood.
  await bailIfDead(page, testInfo);
  await page.getByTestId('tab-activities').click();
  await page.getByTestId('sheet-activities').waitFor({ state: 'visible', timeout: 4000 });
  await shot(page, testInfo, 'tour-14-activities-adult');
  await closeSheet(page, 'activities');
  await page.getByTestId('tab-assets').click();
  await page.getByTestId('sheet-assets').waitFor({ state: 'visible', timeout: 4000 });
  await shot(page, testInfo, 'tour-15-assets');
  await closeSheet(page, 'assets');

  // Midlife and the end of the road.
  await ageYears(page, 20);
  await bailIfDead(page, testInfo);
  await shot(page, testInfo, 'tour-16-life-midlife');
  await ageYears(page, 90);
  if (await page.getByTestId('screen-death').isVisible()) {
    await shot(page, testInfo, 'tour-17-death');
  }
});
