/**
 * The smoke test for the jsdom harness. It renders the simplest component in
 * the app on purpose: a failure here is a wiring failure (jsdom, JSX transform,
 * Testing Library, the `dom` project's setup file), never a product failure.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/design-system';
import { useGameStore } from '@/store/gameStore';
import { useUiStore } from '@/store/uiStore';
import { ageTo, currentGame, startLife } from '@/ui/__tests__/helpers/dom';

describe('Button', () => {
  it('renders its label, icon and test id', () => {
    render(
      <Button icon="🎲" testId="roll">
        Roll
      </Button>,
    );

    const button = screen.getByTestId('roll');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('🎲');
    expect(button).toHaveTextContent('Roll');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('calls onClick once per click', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} testId="roll">
        Roll
      </Button>,
    );

    fireEvent.click(screen.getByTestId('roll'));
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('roll'));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('answers a real pointer sequence, not just a synthetic click', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} testId="roll">
        Roll
      </Button>,
    );

    await userEvent.click(screen.getByTestId('roll'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders the DOM disabled attribute and swallows the click', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled testId="roll">
        Roll
      </Button>,
    );

    const button = screen.getByTestId('roll');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('jsdom harness', () => {
  it('gives every test a DOM, the browser stubs and clean stores', () => {
    expect(typeof window.matchMedia).toBe('function');
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false);
    expect(typeof globalThis.ResizeObserver).toBe('function');
    expect(localStorage.length).toBe(0);

    expect(useGameStore.getState().game).toBeNull();
    expect(useUiStore.getState().sheets).toEqual([]);
    // Springs are off, so a sheet's exit settles inside one `waitFor`.
    expect(useUiStore.getState().settings.reduceMotion).toBe(true);
  });

  it('unmounts the previous test’s tree before the next one renders', () => {
    expect(screen.queryByTestId('roll')).toBeNull();
    render(<Button testId="roll">Roll</Button>);
    expect(screen.getAllByTestId('roll')).toHaveLength(1);
  });

  it('boots and ages a seeded life from the shared helper', () => {
    const game = startLife(4242);

    expect(game.character.age).toBe(0);
    expect(useGameStore.getState().slot).toBe(1);
    // The engine's cursor, not the DOM's — the harness must not disturb it.
    expect(typeof game.rngState).toBe('number');

    ageTo(5);
    expect(currentGame().character.age).toBeGreaterThanOrEqual(5);
  });
});
