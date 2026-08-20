import { beforeEach, describe, expect, it } from 'vitest';

import { memoryStorage } from '@/engine/save';
import type { StorageAdapter } from '@/engine/save';
import { resetUiStoreForTests, useUiStore } from '@/store/uiStore';
import type { SheetEntry, SheetId, ToastItem } from '@/store/uiStore';
import type { Settings } from '@/types';

function sheets(): SheetEntry[] {
  return useUiStore.getState().sheets;
}

function toasts(): ToastItem[] {
  return useUiStore.getState().toasts;
}

function settings(): Settings {
  return useUiStore.getState().settings;
}

/** Queues a toast and reports the id the store gave it, so a test can name the
    one it means without restating how ids are minted. */
function queueToast(title: string): number {
  useUiStore.getState().addToast({ icon: '💬', title });
  const queued = toasts();
  return queued[queued.length - 1].id;
}

/** What the injected adapter holds under `ol.settings`, or `null` when the store
    has not written it — parsed, because the key's shape is what is being pinned. */
function storedSettings(adapter: StorageAdapter): Settings | null {
  const raw = adapter.getItem('ol.settings');
  return raw === null ? null : (JSON.parse(raw) as Settings);
}

/** Eight distinct ids: enough to fill the stack without the top-of-stack
    dedupe ever firing, so each test measures only the depth cap. */
const EIGHT_SHEETS: SheetId[] = [
  'more',
  'finance',
  'health',
  'crime',
  'casino',
  'assets',
  'achievements',
  'settings',
];

beforeEach(() => {
  resetUiStoreForTests(memoryStorage());
});

describe('addToast', () => {
  it('numbers a queue from one after a reset', () => {
    expect([queueToast('first'), queueToast('second')]).toEqual([1, 2]);
  });

  it('mints the id itself, whatever the caller hands it', () => {
    /* The shape a drifted caller — or a JavaScript one — arrives with. The
       store's own id has to win regardless, because `dismissToast` and the
       React key `ToastHost` renders under are both that number. */
    const forged: Omit<ToastItem, 'id'> & { id: number } = {
      icon: '💬',
      title: 'forged',
      id: 99,
    };
    useUiStore.getState().addToast(forged);

    expect(toasts()).toEqual([{ icon: '💬', title: 'forged', id: 1 }]);
  });

  it('keeps only the newest four of a burst', () => {
    const ids = Array.from({ length: 10 }, (_, i) => queueToast(`toast ${String(i)}`));

    expect(toasts()).toHaveLength(4);
    expect(toasts().map((t) => t.id)).toEqual(ids.slice(-4));
    expect(toasts().map((t) => t.title)).toEqual(['toast 6', 'toast 7', 'toast 8', 'toast 9']);
  });

  it('leaves a queue under the cap in arrival order', () => {
    const ids = ['first', 'second', 'third'].map((title) => queueToast(title));

    expect(toasts().map((t) => t.id)).toEqual(ids);
  });

  it('dismisses by id after the queue has dropped its oldest', () => {
    const ids = Array.from({ length: 6 }, (_, i) => queueToast(`toast ${String(i)}`));
    useUiStore.getState().dismissToast(ids[3]);

    expect(toasts().map((t) => t.id)).toEqual([ids[2], ids[4], ids[5]]);
  });
});

describe('pushSheet', () => {
  it('ignores a double-tap on the sheet already on top', () => {
    useUiStore.getState().pushSheet('person', { personId: 'p1' });
    const afterFirst = sheets();

    useUiStore.getState().pushSheet('person', { personId: 'p1' });

    expect(sheets()).toHaveLength(1);
    // The refused push leaves the very array `SheetHost` renders from.
    expect(sheets()).toBe(afterFirst);
  });

  it('does not notify subscribers when it refuses a push', () => {
    useUiStore.getState().pushSheet('more');
    let notified = 0;
    const unsubscribe = useUiStore.subscribe(() => {
      notified += 1;
    });

    useUiStore.getState().pushSheet('more');
    unsubscribe();

    expect(notified).toBe(0);
  });

  it('still opens the same sheet id for different props', () => {
    useUiStore.getState().pushSheet('person', { personId: 'p1' });
    useUiStore.getState().pushSheet('person', { personId: 'p2' });

    expect(sheets().map((s) => s.props)).toEqual([{ personId: 'p1' }, { personId: 'p2' }]);
  });

  it('collapses a repeated props-less push to one dismissal', () => {
    useUiStore.getState().pushSheet('more');
    useUiStore.getState().pushSheet('more');

    expect(sheets()).toHaveLength(1);
    useUiStore.getState().popSheet();
    expect(sheets()).toHaveLength(0);
  });

  it('reopens a sheet that is on the stack but not on top', () => {
    useUiStore.getState().pushSheet('more');
    useUiStore.getState().pushSheet('finance');
    useUiStore.getState().pushSheet('more');

    expect(sheets().map((s) => s.id)).toEqual(['more', 'finance', 'more']);
  });

  it('caps the stack, keeping the sheets already open', () => {
    const pushed: SheetId[] = [...EIGHT_SHEETS, 'occupation', 'education', 'activities', 'event'];
    for (const id of pushed) {
      useUiStore.getState().pushSheet(id);
    }

    expect(sheets()).toHaveLength(8);
    expect(sheets().map((s) => s.id)).toEqual(EIGHT_SHEETS);
  });

  it('accepts a push again once the stack drains below the cap', () => {
    for (const id of EIGHT_SHEETS) {
      useUiStore.getState().pushSheet(id);
    }
    useUiStore.getState().pushSheet('event');
    expect(sheets()).toHaveLength(8);

    useUiStore.getState().popSheet();
    useUiStore.getState().pushSheet('event');

    expect(sheets()).toHaveLength(8);
    expect(sheets()[7].id).toBe('event');
  });

  it('takes every sheet again after closeAllSheets', () => {
    for (const id of EIGHT_SHEETS) {
      useUiStore.getState().pushSheet(id);
    }

    useUiStore.getState().closeAllSheets();
    useUiStore.getState().pushSheet('more');

    expect(sheets().map((s) => s.id)).toEqual(['more']);
  });
});

/* The key is what `SheetHost` mounts an entry under, so these pin the identity
   React sees: it belongs to the entry, not to where the entry sits. */
describe('sheet keys', () => {
  it('gives every entry one of its own, repeated id or not', () => {
    useUiStore.getState().pushSheet('person', { personId: 'p1' });
    useUiStore.getState().pushSheet('person', { personId: 'p2' });
    useUiStore.getState().pushSheet('more');

    const keys = sheets().map((s) => s.key);
    expect(new Set(keys).size).toBe(3);
  });

  it('leaves the sheets above a removed one on the keys they had', () => {
    /* The card arrives while the player is deep in a stack, so the entry the
       router later takes away is the bottom one — the case a stack index
       re-keys, remounting both sheets above it. */
    useUiStore.getState().setEventSheet(true);
    useUiStore.getState().pushSheet('more');
    useUiStore.getState().pushSheet('finance');
    const before = sheets().map((s) => s.key);

    useUiStore.getState().setEventSheet(false);

    expect(sheets().map((s) => s.id)).toEqual(['more', 'finance']);
    expect(sheets().map((s) => s.key)).toEqual(before.slice(1));
  });

  it('never hands a key back to the next sheet', () => {
    useUiStore.getState().pushSheet('finance');
    const first = sheets()[0].key;

    /* The old entry is still on screen playing its exit while this one opens,
       so reusing its key would make React reconcile the two as one sheet. */
    useUiStore.getState().popSheet();
    useUiStore.getState().pushSheet('finance');

    expect(sheets()[0].key).not.toBe(first);
  });
});

describe('setEventSheet', () => {
  /** The stack the phase router must be able to recover from either way: an
      event entry under another sheet, which renders no card and cannot be
      dismissed, so it can be neither answered nor closed by the player. */
  function bury(): void {
    /* Hand-built entries: no action can bury one. The keys are well past
       anything the store's counter reaches from a reset, so an entry the test
       wrote and one the store mints can never collide on a key. */
    const buried: SheetEntry[] = [
      { id: 'event', key: 101 },
      { id: 'more', key: 102 },
    ];
    useUiStore.setState({ sheets: buried });
  }

  it('opens exactly one, however many times it is asked', () => {
    useUiStore.getState().setEventSheet(true);
    const afterFirst = sheets();

    useUiStore.getState().setEventSheet(true);

    expect(sheets().map((s) => s.id)).toEqual(['event']);
    // The sheet that was already right stays the very entry `SheetHost` renders.
    expect(sheets()).toBe(afterFirst);
  });

  it('does not notify subscribers when the stack is already what was asked for', () => {
    useUiStore.getState().pushSheet('more');
    let notified = 0;
    const unsubscribe = useUiStore.subscribe(() => {
      notified += 1;
    });

    useUiStore.getState().setEventSheet(false);
    unsubscribe();

    expect(notified).toBe(0);
    expect(sheets().map((s) => s.id)).toEqual(['more']);
  });

  it('moves a buried event sheet back on top', () => {
    bury();

    useUiStore.getState().setEventSheet(true);

    expect(sheets().map((s) => s.id)).toEqual(['more', 'event']);
  });

  it('removes a buried event sheet, keeping the sheet above it', () => {
    bury();

    useUiStore.getState().setEventSheet(false);

    expect(sheets().map((s) => s.id)).toEqual(['more']);
  });

  it('collapses a stack that somehow holds two of them', () => {
    const doubled: SheetEntry[] = [
      { id: 'event', key: 101 },
      { id: 'more', key: 102 },
      { id: 'event', key: 103 },
    ];
    useUiStore.setState({ sheets: doubled });

    useUiStore.getState().setEventSheet(true);

    expect(sheets().map((s) => s.id)).toEqual(['more', 'event']);
  });

  it('leaves the sheets under it untouched, props and all', () => {
    useUiStore.getState().pushSheet('relationships');
    useUiStore.getState().pushSheet('person', { personId: 'p1' });

    useUiStore.getState().setEventSheet(true);
    useUiStore.getState().setEventSheet(false);

    expect(sheets().map((s) => s.id)).toEqual(['relationships', 'person']);
    expect(sheets()[1].props).toEqual({ personId: 'p1' });
  });

  it('opens over a full stack, which no tap may do', () => {
    for (const id of EIGHT_SHEETS) {
      useUiStore.getState().pushSheet(id);
    }

    /* The depth cap answers a tap repeating faster than the stack drains; this
       is the phase asking for the one sheet the player has no other way to
       answer, so refusing it would strand the life instead of the tap. */
    useUiStore.getState().setEventSheet(true);

    expect(sheets()).toHaveLength(EIGHT_SHEETS.length + 1);
    expect(sheets()[EIGHT_SHEETS.length].id).toBe('event');

    useUiStore.getState().setEventSheet(false);
    expect(sheets().map((s) => s.id)).toEqual(EIGHT_SHEETS);
  });
});

/* The one part of this store with consequences past the tab: a preference the
   player set has to be there on the next boot. None of it could be asserted
   before the adapter was injectable — under the runner every write threw and was
   swallowed, so these tests are the reason the seam exists. */
describe('settings', () => {
  it('writes the theme through to storage', () => {
    const adapter = memoryStorage();
    resetUiStoreForTests(adapter);

    useUiStore.getState().setTheme('dark');

    expect(settings()).toEqual({ theme: 'dark', reduceMotion: false });
    expect(storedSettings(adapter)).toEqual({ theme: 'dark', reduceMotion: false });
  });

  it('writes reduce motion without clobbering the theme', () => {
    const adapter = memoryStorage();
    resetUiStoreForTests(adapter);
    useUiStore.getState().setTheme('light');

    useUiStore.getState().setReduceMotion(true);

    expect(settings()).toEqual({ theme: 'light', reduceMotion: true });
    expect(storedSettings(adapter)).toEqual({ theme: 'light', reduceMotion: true });
  });

  it('reads both back on the next boot over the same storage', () => {
    const adapter = memoryStorage();
    resetUiStoreForTests(adapter);
    useUiStore.getState().setTheme('dark');
    useUiStore.getState().setReduceMotion(true);

    // The reload: a store booting fresh over what the last session left.
    resetUiStoreForTests(adapter);

    expect(settings()).toEqual({ theme: 'dark', reduceMotion: true });
  });

  it('boots on the shipped defaults when the storage holds nothing', () => {
    resetUiStoreForTests(memoryStorage());

    expect(settings()).toEqual({ theme: 'auto', reduceMotion: false });
  });

  it('keeps the preference for this session when the write throws', () => {
    /* A full origin, or Safari private mode: reads work, writes do not. The
       player asked for a theme, so the app owes them one until they close it. */
    const adapter = memoryStorage();
    resetUiStoreForTests({
      getItem: (k: string): string | null => adapter.getItem(k),
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
      removeItem: (k: string): void => {
        adapter.removeItem(k);
      },
    });

    expect(() => {
      useUiStore.getState().setTheme('light');
    }).not.toThrow();
    expect(settings().theme).toBe('light');
    expect(storedSettings(adapter)).toBeNull();
  });

  it('boots on the defaults when the read throws', () => {
    resetUiStoreForTests({
      getItem: (): string | null => {
        throw new Error('storage is unavailable');
      },
      setItem: (): void => {},
      removeItem: (): void => {},
    });

    expect(settings()).toEqual({ theme: 'auto', reduceMotion: false });
  });

  it('hands back a copy of the defaults, not the module constant', () => {
    const unreadable: StorageAdapter = {
      getItem: (): string | null => {
        throw new Error('storage is unavailable');
      },
      setItem: (): void => {},
      removeItem: (): void => {},
    };
    resetUiStoreForTests(unreadable);
    const booted = settings();

    resetUiStoreForTests(unreadable);

    /* The fallback the catch returns is a module constant, and what it returns
       becomes store state: handing the same object to two boots would let one
       of them rewrite the other's. */
    expect(settings()).toEqual(booted);
    expect(settings()).not.toBe(booted);
  });
});

describe('resetUiStoreForTests', () => {
  it('puts every field back to its boot value', () => {
    useUiStore.getState().setScreen('life');
    useUiStore.getState().pushSheet('more');
    queueToast('mid-life');
    useUiStore.getState().setTheme('dark');

    resetUiStoreForTests(memoryStorage());

    expect(useUiStore.getState().screen).toBe('slots');
    expect(sheets()).toEqual([]);
    expect(toasts()).toEqual([]);
    expect(settings()).toEqual({ theme: 'auto', reduceMotion: false });
  });

  it('starts the toast ids and the sheet keys over with them', () => {
    queueToast('first');
    useUiStore.getState().pushSheet('more');

    resetUiStoreForTests(memoryStorage());
    const id = queueToast('first again');
    useUiStore.getState().pushSheet('more');

    expect(id).toBe(1);
    expect(sheets()[0].key).toBe(1);
  });

  it('takes a memory storage of its own when handed no adapter', () => {
    resetUiStoreForTests();

    expect(() => {
      useUiStore.getState().setReduceMotion(true);
    }).not.toThrow();
    expect(settings()).toEqual({ theme: 'auto', reduceMotion: true });
  });
});
