/**
 * End-to-end journeys through One Life: birth, the passage of years, save
 * persistence, employment, settings and death. Assertions are structural and
 * RNG-tolerant — content packs may change, so no test pins event prose.
 */

import { expect, test } from '@playwright/test';

import { ageYears, closeSheet, resolveEventCards, startLife } from './helpers';

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
    // A childhood death still proves the years advanced and events resolved.
    await expect(page.getByTestId('death-cause')).not.toBeEmpty();
    return;
  }
  await expect(headerAge).not.toContainText('Age 0');
  expect(await page.getByTestId('feed-entry').count()).toBeGreaterThan(1);
});

test('the save survives a reload', async ({ page }) => {
  test.setTimeout(120000);
  await startLife(page, 3456);
  await ageYears(page, 5);
  const headerAge = page.getByTestId('header-age');
  await expect(headerAge).toBeVisible();
  const saved = (await headerAge.innerText()).trim();

  await page.reload();
  await expect(page.getByTestId('screen-slots')).toBeVisible();
  await page.getByTestId('slot-row-1').click();
  await page.getByTestId('alert-action-continue').click();
  await expect(page.getByTestId('screen-life')).toBeVisible();
  await expect(page.getByTestId('header-age')).toHaveText(saved);
});

test('a job can be taken', async ({ page }) => {
  test.setTimeout(180000);
  await startLife(page, 4567);
  await ageYears(page, 20);

  await page.getByTestId('tab-occupation').click();
  const sheet = page.getByTestId('sheet-occupation');
  await expect(sheet).toBeVisible();

  const jobRows = sheet.locator('[data-testid^="job-row-"]');
  await expect(jobRows.first()).toBeVisible();
  const count = await jobRows.count();
  let applied = false;
  for (let i = 0; i < count; i += 1) {
    const row = jobRows.nth(i);
    if (await row.isEnabled()) {
      await row.click();
      applied = true;
      break;
    }
  }
  // A failed interview is fine — the application interaction itself must work.
  expect(applied).toBe(true);
  await closeSheet(page, 'occupation');
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
  await expect(page.getByTestId('death-cause')).not.toBeEmpty();

  await page.getByTestId('death-back-to-slots').click();
  await expect(page.getByTestId('screen-slots')).toBeVisible();
  await expect(page.getByTestId('slot-row-1')).toContainText('Deceased');
});
