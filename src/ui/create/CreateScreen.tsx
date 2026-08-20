import { useMemo, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { getRegistry } from '@/content';
import {
  Button,
  Card,
  ListRow,
  NavBar,
  SectionHeader,
  SegmentedControl,
  TextField,
} from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import type { Gender } from '@/types';

/** The gender picker's value: a concrete gender, or a roll from the seed. */
type GenderChoice = Gender | 'random';

const GENDER_OPTIONS: { id: GenderChoice; label: string; testId: string }[] = [
  { id: 'random', label: 'Random', testId: 'create-gender-random' },
  { id: 'male', label: 'Male', testId: 'create-gender-male' },
  { id: 'female', label: 'Female', testId: 'create-gender-female' },
  { id: 'nonbinary', label: 'Non-binary', testId: 'create-gender-nonbinary' },
];

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  /* Content runs under the translucent status bar. */
  paddingTop: 'var(--safe-top)',
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--sp-3)',
  padding: 'var(--sp-4)',
};

const footerStyle: CSSProperties = {
  padding: 'var(--sp-4)',
  /* Clear the home indicator. */
  paddingBottom: 'calc(var(--safe-bottom) + var(--sp-4))',
};

/** Reads an optional `?seed=` override for reproducible test lives. */
function readSeed(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Character creation: name, gender and country before the first year runs. */
export function CreateScreen(): ReactElement {
  const reg = getRegistry();
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [gender, setGender] = useState<GenderChoice>('random');
  const [countryId, setCountryId] = useState<string | undefined>(undefined);
  const seed = useMemo(readSeed, []);

  const startLife = (): void => {
    /* Trimmed here because `createLife` stores whatever it is handed verbatim:
       a whitespace-only field would otherwise become a blank name in the header,
       in every `{name}` token of the prose, and in the obituary. Blank after
       trimming means "no choice", so the engine rolls a name as it does for an
       untouched field. */
    const trimmedFirst = first.trim();
    const trimmedLast = last.trim();
    /* The slot the load menu armed with `beginNewLife`, falling back to the
       first one for a create screen reached without one. `newLife` itself
       switches to the life screen. */
    useGameStore.getState().newLife({
      slot: useGameStore.getState().slot ?? 1,
      seed,
      firstName: trimmedFirst !== '' ? trimmedFirst : undefined,
      lastName: trimmedLast !== '' ? trimmedLast : undefined,
      gender: gender === 'random' ? undefined : gender,
      countryId,
    });
  };

  return (
    <div data-testid="screen-create" style={rootStyle}>
      <NavBar
        title="New Life"
        left={
          <Button
            variant="plain"
            size="sm"
            onClick={() => {
              useUiStore.getState().setScreen('slots');
            }}
          >
            Back
          </Button>
        }
      />
      <div style={bodyStyle}>
        <TextField
          label="First name"
          value={first}
          onChange={setFirst}
          placeholder="Random"
          maxLength={24}
          testId="create-first-name"
        />
        <TextField
          label="Last name"
          value={last}
          onChange={setLast}
          placeholder="Random"
          maxLength={24}
          testId="create-last-name"
        />
        <SectionHeader>Gender</SectionHeader>
        <SegmentedControl
          options={GENDER_OPTIONS}
          value={gender}
          onChange={(id) => {
            const option = GENDER_OPTIONS.find((o) => o.id === id);
            if (option !== undefined) {
              setGender(option.id);
            }
          }}
        />
        <SectionHeader>Country</SectionHeader>
        <Card>
          <ListRow
            icon="🎲"
            title="Random"
            value={countryId === undefined ? '✓' : undefined}
            testId="create-country-random"
            onClick={() => {
              setCountryId(undefined);
            }}
          />
          {reg.countries.map((country) => (
            <ListRow
              key={country.id}
              icon={country.flag}
              title={country.label}
              value={countryId === country.id ? '✓' : undefined}
              testId={`create-country-${country.id}`}
              onClick={() => {
                setCountryId(country.id);
              }}
            />
          ))}
        </Card>
      </div>
      <div style={footerStyle}>
        <Button variant="filled" size="lg" fullWidth testId="create-start" onClick={startLife}>
          Start life
        </Button>
      </div>
    </div>
  );
}
