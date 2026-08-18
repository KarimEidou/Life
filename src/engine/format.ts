/**
 * Display formatting and narrative text templating.
 *
 * Pure helpers: nothing here reads or writes game state beyond the values it is
 * handed, so the UI and the engine can both call them freely.
 */

import type { Ctx, GameState, Person } from '@/types';

/** Groups an unsigned integer with commas without depending on host locale data. */
function group(abs: number): string {
  return String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Rounds to one decimal place; `String` then drops a trailing `.0` for free. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Formats a whole-currency amount, e.g. `$12,340` and `-$500` for negatives. */
export function fmtMoney(n: number): string {
  const whole = Math.round(Number.isFinite(n) ? n : 0);
  const sign = whole < 0 ? '-' : '';
  return `${sign}$${group(Math.abs(whole))}`;
}

/** Formats money with a magnitude suffix for tight spaces, e.g. `$1.2M`. */
export function fmtMoneyCompact(n: number): string {
  const whole = Math.round(Number.isFinite(n) ? n : 0);
  const sign = whole < 0 ? '-' : '';
  const abs = Math.abs(whole);
  if (abs < 1e4) return fmtMoney(whole);
  // Each tier promotes when its own rounding carries into the next one, so
  // 999,999 reads "$1M" rather than "$1000K".
  const thousands = Math.round(abs / 1e3);
  if (thousands < 1000) return `${sign}$${thousands}K`;
  const millions = round1(abs / 1e6);
  if (millions < 1000) return `${sign}$${millions}M`;
  return `${sign}$${round1(abs / 1e9)}B`;
}

/** Name of the current spouse, else the current partner, else undefined. */
function currentPartner(state: GameState): Person | undefined {
  const people = Object.values(state.people);
  return (
    people.find((p) => p.alive && p.kind === 'spouse') ??
    people.find((p) => p.alive && p.kind === 'partner')
  );
}

/** Substitutes `{name} {firstName} {lastName} {he} {him} {his} {partner} {country} {age}`. */
export function fillTemplate(text: string, state: GameState): string {
  if (text.indexOf('{') === -1) return text;
  const c = state.character;
  const partner = currentPartner(state);
  // Null prototype: token text is player-reachable (a typed first name is echoed
  // back through resolveText), so `{toString}` must not find an inherited member.
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  values.name = `${c.firstName} ${c.lastName}`.trim();
  values.firstName = c.firstName;
  values.lastName = c.lastName;
  values.he = c.pronouns.sub;
  values.him = c.pronouns.obj;
  values.his = c.pronouns.pos;
  values.partner = partner ? partner.name : 'your partner';
  // createLife stores the human-readable country label; the id is the fallback.
  values.country = String(c.flags.countryLabel ?? c.countryId);
  values.age = String(c.age);
  // Belt and braces: only an own string value ever leaves the table, so nothing
  // non-string can reach `.charAt` below no matter how the table is built.
  const lookup = (key: string): string | undefined => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return undefined;
    const found: unknown = values[key];
    return typeof found === 'string' ? found : undefined;
  };
  return text.replace(/\{(\w+)\}/g, (whole: string, key: string): string => {
    const direct = lookup(key);
    if (direct !== undefined) return direct;
    // `{He}` / `{Partner}` at the start of a sentence resolve to a capitalised value.
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    const alt = lookup(lower);
    if (alt === undefined) return whole; // unknown tokens stay visible instead of vanishing
    return alt.charAt(0).toUpperCase() + alt.slice(1);
  });
}

/** Resolves content text that may be a literal or a builder, then fills its templates. */
export function resolveText(text: string | ((ctx: Ctx) => string), ctx: Ctx): string {
  const raw = typeof text === 'function' ? text(ctx) : text;
  return fillTemplate(raw, ctx.state);
}
