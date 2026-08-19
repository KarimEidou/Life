/**
 * End-to-end journeys through One Life: birth, the passage of years, save
 * persistence, employment, settings and death. Assertions are structural and
 * RNG-tolerant — content packs may change, so no test pins event prose.
 */

import { expect, test } from '@playwright/test';

import { ageYears, closeSheet, resolveEventCards, startLife } from './helpers';

/**
 * The obituary line reads `${cause} at age ${age}`, so the node holds text
 * whatever the cause is and a non-empty check can never fail. `^\S` demands a
 * stated cause — Playwright skips its whitespace normalisation for a RegExp, so
 * a blank cause leaves the leading space that fails here. `[1-9]` demands an age
 * past birth: the aging phase raises the age before any later phase can kill, so
 * no death reached by ageing lands at 0.
 */
const DEATH_CAUSE_LINE = /^\S.*\bat age [1-9]\d*$/;

/**
 * `OccupationSheet` swaps every listing for this notice while a sentence runs,
 * so a jailed round has nothing to apply to. Matching the prose is the only
 * handle the sheet offers, and it fails the safe way: if the wording moves, the
 * round falls through to the listings and the missing rows fail loudly.
 */
const PRISON_NOTICE = "You're in prison.";

test('new life is born', async ({ page }) => {
  await startLife(page, 1234, {
    firstName: 'Test',
    lastName: 'Person',
    gender: 'female',
    countryId: 'us',
  });
  await expect(page.getByTestId('header-age')).toContainText('Age 0');
  await expect(page.getByTestId('feed-entry').first()).toBeVisible();
});

test('years pass and events resolve', async ({ page }) => {
  test.setTimeout(120000);
  await startLife(page, 2345);
  await ageYears(page, 15);

  // Settle the race between the life screen and a just-triggered death.
  const death = page.getByTestId('screen-death');
  const headerAge = page.getByTestId('header-age');
  await expect(death.or(headerAge)).toBeVisible();
  if (await death.isVisible()) {
    // A childhood death still proves the years advanced: the obituary names the
    // age this life reached, and only a completed year can have ended it.
    await expect(page.getByTestId('death-cause')).toHaveText(DEATH_CAUSE_LINE);
    return;
  }
  await expect(headerAge).not.toContainText('Age 0');
  expect(await page.getByTestId('feed-entry').count()).toBeGreaterThan(1);
});

test('the save survives a reload', async ({ page }) => {
  test.setTimeout(120000);
  await startLife(page, 3456);
  await ageYears(page, 5);

  /* Settle the alive/dead race before reading the header: it lives in
     `LifeScreen`, which death unmounts, so a seed the packs turn lethal would
     fail here on a missing element rather than on anything about saving. A
     finished life is saved too, so the dead branch reloads the obituary
     instead of skipping — the claim under test is checkable either way. */
  const death = page.getByTestId('screen-death');
  const headerAge = page.getByTestId('header-age');
  const cause = page.getByTestId('death-cause');
  await expect(death.or(headerAge)).toBeVisible();
  const died = await death.isVisible();
  if (died) {
    await expect(cause).toHaveText(DEATH_CAUSE_LINE);
  }
  const saved = (await (died ? cause : headerAge).innerText()).trim();

  await page.reload();
  await expect(page.getByTestId('screen-slots')).toBeVisible();
  const slot = page.getByTestId('slot-row-1');
  if (died) {
    await expect(slot).toContainText('Deceased');
  }
  await slot.click();
  await page.getByTestId('alert-action-continue').click();

  if (died) {
    // `loadSlot` routes a finished life straight back to its obituary.
    await expect(page.getByTestId('screen-death')).toBeVisible();
    await expect(cause).toHaveText(saved);
    return;
  }
  await expect(page.getByTestId('screen-life')).toBeVisible();
  await expect(headerAge).toHaveText(saved);
});

test('a job can be taken', async ({ page }) => {
  test.setTimeout(180000);
  await startLife(page, 4567);
  await ageYears(page, 20);

  // Interviews can be failed, so keep applying (aging a year between rounds)
  // until the current-job card — and its Quit button — proves employment.
  const death = page.getByTestId('screen-death');
  const tab = page.getByTestId('tab-occupation');
  let hired = false;
  let jailed = false;
  for (let round = 0; round < 6 && !hired; round += 1) {
    /* The tab bar goes with `LifeScreen` when the life ends, and the click
       below would auto-wait on a tab that is never coming back, so settle the
       race first. A death still owes a coherent obituary; what it cannot do is
       take a job, so the run is marked skipped rather than passed. */
    await expect(death.or(tab)).toBeVisible();
    if (await death.isVisible()) {
      await expect(page.getByTestId('death-cause')).toHaveText(DEATH_CAUSE_LINE);
      test.skip(true, 'seed 4567 died before it could be hired');
    }

    await tab.click();
    const sheet = page.getByTestId('sheet-occupation');
    await expect(sheet).toBeVisible();

    if (await sheet.getByTestId('job-quit').isVisible()) {
      hired = true;
    } else {
      // Nobody is hired out of a cell; a jailed round just serves a year.
      jailed = await sheet.getByText(PRISON_NOTICE).isVisible();
      if (!jailed) {
        const jobRows = sheet.locator('[data-testid^="job-row-"]');
        await expect(jobRows.first()).toBeVisible();
        const count = await jobRows.count();
        for (let i = 0; i < count; i += 1) {
          await jobRows.nth(i).click();
          if (await sheet.getByTestId('job-quit').isVisible()) {
            hired = true;
            break;
          }
        }
      }
    }
    await closeSheet(page, 'occupation');
    if (!hired) {
      await ageYears(page, 1);
    }
  }
  // Only a sentence outlasting every round: the rest of the seed's luck is the
  // interview odds the loop is there to absorb, and those still have to land.
  test.skip(jailed && !hired, 'seed 4567 was serving time for the whole hiring window');
  expect(hired).toBe(true);
});

test('theme and reduce motion apply', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('screen-slots')).toBeVisible();
  await page.getByTestId('slots-settings').click();
  const sheet = page.getByTestId('sheet-settings');
  await expect(sheet).toBeVisible();

  const html = page.locator('html');
  await sheet.getByTestId('settings-theme-dark').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await sheet.getByTestId('settings-reduce-motion').click();
  await expect(html).toHaveAttribute('data-reduce-motion', 'true');
  await sheet.getByTestId('settings-theme-light').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('every life ends', async ({ page }) => {
  test.setTimeout(300000);
  await startLife(page, 5678);
  await resolveEventCards(page);

  // Reduce motion first: 130 years of sheet springs add up.
  await page.getByTestId('tab-more').click();
  const more = page.getByTestId('sheet-more');
  await expect(more).toBeVisible();
  await more.getByTestId('more-settings').click();
  const settings = page.getByTestId('sheet-settings');
  await expect(settings).toBeVisible();
  await settings.getByTestId('settings-reduce-motion').click();
  await closeSheet(page, 'settings');
  await closeSheet(page, 'more');

  await ageYears(page, 130);
  await expect(page.getByTestId('screen-death')).toBeVisible();
  await expect(page.getByTestId('death-cause')).toHaveText(DEATH_CAUSE_LINE);

  await page.getByTestId('death-back-to-slots').click();
  await expect(page.getByTestId('screen-slots')).toBeVisible();
  await expect(page.getByTestId('slot-row-1')).toContainText('Deceased');
});
