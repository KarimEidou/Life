import { describe, expect, it } from 'vitest';

import type { Character, ContentRegistry, Ctx, GameState, Person, RelKind } from '@/types';
import { fillTemplate, fmtMoney, fmtMoneyCompact, resolveText } from '@/engine/format';
import { createRng, initialRngState } from '@/engine/rng';

// Hand-rolled fixtures: `createLife` and `buildRegistry` belong to other modules.
function emptyRegistry(): ContentRegistry {
  return {
    packs: [],
    events: [],
    eventsById: {},
    interactions: [],
    interactionsById: {},
    jobs: [],
    jobsById: {},
    assets: [],
    assetsById: {},
    illnesses: [],
    illnessesById: {},
    schools: [],
    schoolsById: {},
    countries: [],
    countriesById: {},
    crimes: [],
    crimesById: {},
    achievements: [],
    achievementsById: {},
    namePools: {},
  };
}

function makeCharacter(over: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    firstName: 'Ada',
    lastName: 'Moreno',
    gender: 'female',
    pronouns: { sub: 'she', obj: 'her', pos: 'her' },
    countryId: 'jp',
    age: 34,
    stats: { health: 60, happiness: 55, smarts: 70, looks: 45 },
    money: 5000,
    education: { level: 'high', year: 0, gpa: 3.1, studyHard: false },
    job: null,
    prison: null,
    assets: [],
    loans: [],
    investments: { savings: 0, index: 0, crypto: 0 },
    illnesses: [],
    addictions: {},
    fame: 0,
    flags: {},
    ...over,
  };
}

function makePerson(id: string, kind: RelKind, over: Partial<Person> = {}): Person {
  return {
    id,
    kind,
    name: `Person ${id}`,
    gender: 'male',
    age: 36,
    alive: true,
    rel: 50,
    flags: {},
    ...over,
  };
}

function makeState(character: Character, people: Person[] = []): GameState {
  const byId: Record<string, Person> = {};
  for (const p of people) byId[p.id] = p;
  return {
    rngState: initialRngState(1),
    seed: 1,
    generation: 1,
    year: 2026,
    character,
    people: byId,
    log: [],
    pending: [],
    firedEvents: [],
    interactionUse: {},
    ancestors: [],
    phase: 'alive',
  };
}

function makeCtx(state: GameState): Ctx {
  return { state, c: state.character, rng: createRng(state), reg: emptyRegistry() };
}

describe('fmtMoney', () => {
  it('formats whole dollars with thousands separators', () => {
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtMoney(7)).toBe('$7');
    expect(fmtMoney(999)).toBe('$999');
    expect(fmtMoney(1000)).toBe('$1,000');
    expect(fmtMoney(12340)).toBe('$12,340');
    expect(fmtMoney(1234567)).toBe('$1,234,567');
    expect(fmtMoney(1000000000)).toBe('$1,000,000,000');
  });

  it('puts the sign ahead of the symbol for negatives', () => {
    expect(fmtMoney(-500)).toBe('-$500');
    expect(fmtMoney(-1234567)).toBe('-$1,234,567');
  });

  it('rounds fractional cents to whole dollars', () => {
    expect(fmtMoney(12.6)).toBe('$13');
    expect(fmtMoney(12.4)).toBe('$12');
    expect(fmtMoney(-0.4)).toBe('$0');
    expect(fmtMoney(-1200.5)).toBe('-$1,200');
  });
});

describe('fmtMoneyCompact', () => {
  it('spells out amounts below $10,000 in full', () => {
    expect(fmtMoneyCompact(0)).toBe('$0');
    expect(fmtMoneyCompact(999)).toBe('$999');
    expect(fmtMoneyCompact(9999)).toBe('$9,999');
    expect(fmtMoneyCompact(-9999)).toBe('-$9,999');
  });

  it('uses K from $10,000 and M from a million', () => {
    expect(fmtMoneyCompact(10000)).toBe('$10K');
    expect(fmtMoneyCompact(12340)).toBe('$12K');
    expect(fmtMoneyCompact(750000)).toBe('$750K');
    expect(fmtMoneyCompact(1234567)).toBe('$1.2M');
    expect(fmtMoneyCompact(2500000)).toBe('$2.5M');
    expect(fmtMoneyCompact(1000000)).toBe('$1M');
    expect(fmtMoneyCompact(-1234567)).toBe('-$1.2M');
  });

  it('promotes to the next unit instead of printing $1000K', () => {
    expect(fmtMoneyCompact(999999)).toBe('$1M');
    expect(fmtMoneyCompact(1000000000)).toBe('$1B');
    expect(fmtMoneyCompact(2400000000)).toBe('$2.4B');
  });
});

describe('fillTemplate', () => {
  it('substitutes every supported placeholder', () => {
    const state = makeState(
      makeCharacter({ flags: { countryLabel: 'Japan' } }),
      [makePerson('1', 'spouse', { name: 'Kenji Moreno' })]
    );
    const text =
      '{name} ({firstName}/{lastName}) is {age}. {he} loves {partner}; give {him} {his} keys in {country}.';
    expect(fillTemplate(text, state)).toBe(
      'Ada Moreno (Ada/Moreno) is 34. she loves Kenji Moreno; give her her keys in Japan.'
    );
  });

  it('falls back to the country id when no label was stored', () => {
    const state = makeState(makeCharacter());
    expect(fillTemplate('You live in {country}.', state)).toBe('You live in jp.');
  });

  it('prefers a living spouse, then a living partner, then a generic phrase', () => {
    const generic = makeState(makeCharacter());
    expect(fillTemplate('{partner}', generic)).toBe('your partner');

    const dating = makeState(makeCharacter(), [makePerson('1', 'partner', { name: 'Rosa' })]);
    expect(fillTemplate('{partner}', dating)).toBe('Rosa');

    const married = makeState(makeCharacter(), [
      makePerson('1', 'partner', { name: 'Rosa' }),
      makePerson('2', 'spouse', { name: 'Yuki' }),
    ]);
    expect(fillTemplate('{partner}', married)).toBe('Yuki');

    const widowed = makeState(makeCharacter(), [
      makePerson('1', 'spouse', { name: 'Yuki', alive: false }),
      makePerson('2', 'partner', { name: 'Rosa' }),
    ]);
    expect(fillTemplate('{partner}', widowed)).toBe('Rosa');

    const alone = makeState(makeCharacter(), [
      makePerson('1', 'spouse', { name: 'Yuki', alive: false }),
      makePerson('2', 'mother', { name: 'Mom' }),
    ]);
    expect(fillTemplate('{partner}', alone)).toBe('your partner');
  });

  it('uses the character pronouns and capitalises capitalised tokens', () => {
    const state = makeState(
      makeCharacter({ gender: 'nonbinary', pronouns: { sub: 'they', obj: 'them', pos: 'their' } })
    );
    expect(fillTemplate('{He} shrugged. It was {his} call; nobody told {him}.', state)).toBe(
      'They shrugged. It was their call; nobody told them.'
    );
  });

  it('leaves unknown tokens and brace-free text alone', () => {
    const state = makeState(makeCharacter());
    expect(fillTemplate('You got a raise.', state)).toBe('You got a raise.');
    expect(fillTemplate('{nope} {name}', state)).toBe('{nope} Ada Moreno');
  });

  it('does not re-scan substituted values for placeholders', () => {
    const state = makeState(makeCharacter({ firstName: '{age}' }));
    expect(fillTemplate('{firstName}', state)).toBe('{age}');
  });
});

describe('resolveText', () => {
  it('fills a literal string', () => {
    const ctx = makeCtx(makeState(makeCharacter()));
    expect(resolveText('{firstName} turns {age}.', ctx)).toBe('Ada turns 34.');
  });

  it('calls a builder with the context and fills its result', () => {
    const ctx = makeCtx(makeState(makeCharacter({ money: 4200 })));
    const built = resolveText((c) => `{name} has ${c.c.money} left.`, ctx);
    expect(built).toBe('Ada Moreno has 4200 left.');
  });
});
