/**
 * Shared Playwright helpers for the One Life e2e suites. This file is compiled
 * by Playwright itself, so it imports only from @playwright/test.
 */

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Optional create-screen choices applied before the life starts. */
export interface StartLifeOptions {
  firstName?: string;
  lastName?: string;
  gender?: 'random' | 'male' | 'female' | 'nonbinary';
  countryId?: string;
}

/** Boots a deterministic life: seed in the URL, slot 1, straight to the life screen. */
export async function startLife(page: Page, seed: number, opts: StartLifeOptions = {}): Promise<void> {
  await page.goto(`/?seed=${String(seed)}`);
  await expect(page.getByTestId('screen-slots')).toBeVisible();
  await page.getByTestId('slot-row-1').click();
  await expect(page.getByTestId('screen-create')).toBeVisible();
  if (opts.firstName !== undefined) {
    await page.getByTestId('create-first-name').fill(opts.firstName);
  }
  if (opts.lastName !== undefined) {
    await page.getByTestId('create-last-name').fill(opts.lastName);
  }
  if (opts.gender !== undefined) {
    await page.getByTestId(`create-gender-${opts.gender}`).click();
  }
  if (opts.countryId !== undefined) {
    await page.getByTestId(`create-country-${opts.countryId}`).click();
  }
  await page.getByTestId('create-start').click();
  await expect(page.getByTestId('screen-life')).toBeVisible();
}

/**
 * Taps event-choice-0 until the event sheet detaches. Bounded: a resolved card
 * can queue a follow-up card under the same sheet, but never endlessly.
 */
export async function resolveEventCards(page: Page, maxCards = 8): Promise<void> {
  const sheet = page.getByTestId('sheet-event');
  for (let card = 0; card < maxCards; card += 1) {
    if (!(await sheet.isVisible())) {
      return;
    }
    try {
      await sheet.getByTestId('event-choice-0').click({ timeout: 2000 });
    } catch {
      // The card resolved or re-rendered mid-click; re-check the sheet.
    }
    try {
      await sheet.waitFor({ state: 'hidden', timeout: 1500 });
      return;
    } catch {
      // Still up: a queued follow-up card took over. Loop and choose again.
    }
  }
}

/**
 * Advances up to n years. Each pass resolves any blocking event cards first,
 * then taps the age button once; the loop stops early on the death screen.
 */
export async function ageYears(page: Page, n: number): Promise<void> {
  const death = page.getByTestId('screen-death');
  for (let i = 0; i < n; i += 1) {
    if (await death.isVisible()) {
      return;
    }
    await resolveEventCards(page);
    if (await death.isVisible()) {
      return;
    }
    try {
      await page.getByTestId('age-button').click({ timeout: 4000 });
    } catch {
      // An event sheet slid over the button mid-click; the next pass resolves it.
    }
  }
  // Leave no dangling card behind for whatever the test does next.
  await resolveEventCards(page);
}

/** Closes one sheet via the Done button scoped inside it, and waits for it to go. */
export async function closeSheet(page: Page, sheetId: string): Promise<void> {
  const sheet = page.getByTestId(`sheet-${sheetId}`);
  await sheet.getByTestId('sheet-close').click();
  await expect(sheet).toBeHidden();
}
