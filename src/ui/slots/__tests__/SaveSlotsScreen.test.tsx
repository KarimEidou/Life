/**
 * The load menu's job at the edges: a slot this build cannot open must not read
 * as free space, and must not reach the create screen without a confirmation.
 * Overwriting a save is the one action the game cannot undo, and a damaged save
 * is exactly the one a player would replace by accident.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryStorage } from '@/engine/save';
import type { StorageAdapter } from '@/engine/save';
import { resetGameStoreForTests, useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import { SAVE_VERSION } from '@/types';
import { SaveSlotsScreen } from '@/ui/slots/SaveSlotsScreen';

let storage: StorageAdapter;

beforeEach(() => {
  // The harness already reset the store; this one is the adapter tests can seed.
  storage = memoryStorage();
  resetGameStoreForTests(storage);
});

/** A payload cut short mid-write, as a full origin leaves one behind. */
function seedDamaged(slot: number): void {
  storage.setItem(`ol.save.${String(slot)}`, '{"version":1,"savedAt":5,"slot":1,"state":{"chara');
}

/** A healthy save this build is simply too old to open. */
function seedFuture(slot: number): void {
  storage.setItem(
    `ol.save.${String(slot)}`,
    JSON.stringify({
      version: SAVE_VERSION + 1,
      savedAt: 6,
      slot,
      state: { character: { firstName: 'Ada', lastName: 'Byron', age: 34 } },
    }),
  );
}

/** Bends one container in a saved slot out of shape: still a life, not as written. */
function damageOneField(slot: number): void {
  const raw = storage.getItem(`ol.save.${String(slot)}`);
  if (raw === null) {
    throw new Error('expected an autosaved slot');
  }
  const envelope = JSON.parse(raw) as { state: Record<string, unknown> };
  envelope.state.log = 'not a log';
  storage.setItem(`ol.save.${String(slot)}`, JSON.stringify(envelope));
}

/** A reload onto the same storage, with the seeding life's toasts left behind. */
function reopenSlots(): void {
  resetGameStoreForTests(storage);
  useUiStore.setState({ screen: 'slots', toasts: [] });
}

describe('SaveSlotsScreen', () => {
  it('presents a damaged save as damaged, never as an empty slot', () => {
    seedDamaged(1);
    render(<SaveSlotsScreen />);

    const row = screen.getByTestId('slot-row-1');
    expect(row).toHaveTextContent('⚠️');
    expect(row).toHaveTextContent('Damaged save');
    expect(row).toHaveTextContent('This save could not be read');
    expect(row).not.toHaveTextContent('Empty slot');
    expect(row).not.toHaveTextContent('Start a new life');
  });

  it('confirms before a damaged row can reach the create screen', () => {
    seedDamaged(1);
    render(<SaveSlotsScreen />);

    fireEvent.click(screen.getByTestId('slot-row-1'));
    // The tap opens the same Continue/Delete confirmation an ordinary save gets.
    expect(screen.getByTestId('alert-action-continue')).toBeInTheDocument();
    expect(screen.getByTestId('alert-action-delete')).toBeInTheDocument();
    expect(screen.getByText(/Continue tries to recover it/)).toBeInTheDocument();
    expect(useUiStore.getState().screen).toBe('slots');
    expect(useGameStore.getState().slot).toBeNull();

    fireEvent.click(screen.getByTestId('alert-action-cancel'));
    expect(screen.queryByTestId('alert-action-continue')).toBeNull();
    expect(useUiStore.getState().screen).toBe('slots');
    // Nothing was written over it: the payload is still there to try again.
    expect(storage.getItem('ol.save.1')).not.toBeNull();
  });

  it('reports the failure when Continue cannot read the slot after all', () => {
    seedDamaged(1);
    render(<SaveSlotsScreen />);

    fireEvent.click(screen.getByTestId('slot-row-1'));
    fireEvent.click(screen.getByTestId('alert-action-continue'));

    expect(useUiStore.getState().screen).toBe('slots');
    expect(useUiStore.getState().toasts.map((t) => t.title)).toEqual([
      'That save could not be read.',
    ]);
  });

  it('words the refusal from a newer build as an update, not as damage', () => {
    seedFuture(2);
    render(<SaveSlotsScreen />);

    fireEvent.click(screen.getByTestId('slot-row-2'));
    fireEvent.click(screen.getByTestId('alert-action-continue'));

    expect(useUiStore.getState().screen).toBe('slots');
    expect(useUiStore.getState().toasts.map((t) => t.title)).toEqual([
      'This save needs a newer version of the game.',
    ]);
    // A refusal erases nothing: the save is still there for a build that can open it.
    expect(storage.getItem('ol.save.2')).not.toBeNull();
  });

  it('says so when Continue had to recover the save it opened', () => {
    useGameStore.getState().newLife({ slot: 4, seed: 7 });
    damageOneField(4);
    reopenSlots();
    render(<SaveSlotsScreen />);

    fireEvent.click(screen.getByTestId('slot-row-4'));
    fireEvent.click(screen.getByTestId('alert-action-continue'));

    // Recovered rather than refused: the life opens, and the player is told.
    expect(useUiStore.getState().screen).toBe('life');
    expect(useUiStore.getState().toasts.map((t) => t.title)).toEqual([
      'Recovered a damaged save.',
    ]);
  });

  it('opens a save that needed no recovery without saying anything', () => {
    useGameStore.getState().newLife({ slot: 4, seed: 7 });
    reopenSlots();
    render(<SaveSlotsScreen />);

    fireEvent.click(screen.getByTestId('slot-row-4'));
    fireEvent.click(screen.getByTestId('alert-action-continue'));

    expect(useUiStore.getState().screen).toBe('life');
    expect(useUiStore.getState().toasts).toEqual([]);
  });

  it('names the life a newer build saved and steers away from replacing it', () => {
    seedFuture(2);
    render(<SaveSlotsScreen />);

    const row = screen.getByTestId('slot-row-2');
    expect(row).toHaveTextContent('⚠️');
    expect(row).toHaveTextContent('Ada Byron');
    expect(row).toHaveTextContent('Saved by a newer version of the game');

    fireEvent.click(row);
    expect(screen.getByText(/Update the game to open it/)).toBeInTheDocument();
    expect(useUiStore.getState().screen).toBe('slots');
  });

  it('still hands an untouched slot straight to the create screen', () => {
    render(<SaveSlotsScreen />);

    const row = screen.getByTestId('slot-row-3');
    expect(row).toHaveTextContent('Empty slot');
    expect(row).toHaveTextContent('Start a new life');

    fireEvent.click(row);
    expect(useUiStore.getState().screen).toBe('create');
    expect(useGameStore.getState().slot).toBe(3);
  });

  it('captions a healthy save with its life instead of a warning', () => {
    useGameStore.getState().newLife({ slot: 5, seed: 7 });
    useUiStore.getState().setScreen('slots');
    render(<SaveSlotsScreen />);

    const row = screen.getByTestId('slot-row-5');
    expect(row).toHaveTextContent('🧬');
    expect(row).toHaveTextContent('Age 0 · Gen 1');
    expect(row).not.toHaveTextContent('could not be read');
  });
});
