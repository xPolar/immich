import { searchAssets, searchPerson, searchSmart } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { GlobalSearchManager } from './global-search-manager.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { authenticated: true, user: { id: 'user-1', isAdmin: false } },
}));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { map: true, trash: true } },
}));
vi.mock('./command-items', () => ({
  COMMAND_ITEMS: [],
  isAlmostExactCommandMatch: vi.fn(() => false),
}));
vi.mock('./navigation-items', () => ({
  NAVIGATION_ITEMS: [],
  isAlmostExactNavigationMatch: vi.fn(() => false),
}));
vi.mock('@immich/sdk', () => ({
  getAllAlbums: vi.fn(() => Promise.resolve([])),
  getAllPeople: vi.fn(() => Promise.resolve({ people: [] })),
  getAllTags: vi.fn(() => Promise.resolve([])),
  getSearchSuggestions: vi.fn(() => Promise.resolve([])),
  searchAssets: vi.fn(() => Promise.resolve({ assets: { items: [], total: 0 } })),
  searchPerson: vi.fn(() => Promise.resolve([])),
  searchPlaces: vi.fn(() => Promise.resolve([])),
  searchSmart: vi.fn(() => Promise.resolve({ assets: { items: [], total: 0 } })),
}));

describe('GlobalSearchManager keyboard state', () => {
  let manager: GlobalSearchManager;

  beforeEach(() => {
    manager = new GlobalSearchManager();
    localStorage.clear();
  });

  it('toggles one global palette and restores trigger focus', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    manager.toggle('modal', trigger);
    expect(manager.isOpen).toBe(true);
    manager.toggle();
    await Promise.resolve();
    expect(manager.isOpen).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('does not restore focus when closing the focus-to-open dropdown', async () => {
    const trigger = document.createElement('input');
    const outside = document.createElement('button');
    document.body.append(trigger, outside);
    manager.open('dropdown', trigger);
    outside.focus();
    manager.close();
    await Promise.resolve();
    expect(document.activeElement).toBe(outside);
  });

  it('cycles search modes in the declared order', () => {
    expect(manager.mode).toBe('smart');
    manager.cycleMode();
    expect(manager.mode).toBe('metadata');
    manager.cycleMode();
    expect(manager.mode).toBe('description');
    manager.cycleMode();
    expect(manager.mode).toBe('ocr');
    manager.cycleMode();
    expect(manager.mode).toBe('smart');
  });

  it('persists an explicitly selected mode', () => {
    manager.setMode('ocr');
    expect(localStorage.getItem('searchQueryType')).toBe('ocr');
    expect(new GlobalSearchManager().mode).toBe('ocr');
  });

  it('does not change or persist modes while scoped', () => {
    manager.mode = 'smart';
    manager.scope = 'people';
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    manager.setMode('ocr');
    expect(manager.mode).toBe('smart');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('does not persist when selecting the current mode', () => {
    manager.mode = 'smart';
    manager.scope = 'all';
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    manager.setMode('smart');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('keeps successful stale results while a replacement provider is pending', async () => {
    vi.useFakeTimers();
    const first = [{ id: 'person-1', name: 'Alice', isFavorite: false }];
    vi.mocked(searchPerson)
      .mockResolvedValueOnce(first as never)
      .mockReturnValueOnce(new Promise(() => {}));

    manager.setQuery('@alice');
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.sections.people).toMatchObject({ status: 'ok', items: first });

    manager.setQuery('@alicia');
    expect(manager.sections.people).toMatchObject({ status: 'ok', items: first });
    expect(manager.pendingProviders).toContain('people');
    vi.useRealTimers();
  });

  it('times out a slow provider after 15 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(searchPerson).mockReturnValueOnce(new Promise(() => {}));
    manager.setQuery('@slow');
    await vi.advanceTimersByTimeAsync(15_151);
    expect(manager.providerErrors.people).toBe('Search is taking too long');
    expect(manager.pendingProviders).not.toContain('people');
    vi.useRealTimers();
  });

  it('uses metadata search with filters only for filter-only typed searches', async () => {
    vi.useFakeTimers();
    manager.mode = 'smart';
    manager.setQuery('favorite:true');
    await vi.advanceTimersByTimeAsync(150);

    expect(searchSmart).not.toHaveBeenCalled();
    expect(searchAssets).toHaveBeenCalledWith(
      { metadataSearchDto: expect.objectContaining({ isFavorite: true, size: 5 }) },
      expect.anything(),
    );
    vi.useRealTimers();
  });

  it('keeps typed suggestions before ordinary results', () => {
    manager.query = 'person:ali cats';
    manager.typedSuggestions = {
      status: 'ok',
      key: 'person',
      total: 1,
      items: [
        {
          id: 'alice',
          key: 'person',
          label: 'Alice',
          value: 'Alice',
          tokenStart: 0,
          tokenEnd: 10,
        },
      ],
    };
    manager.sections.people = {
      status: 'ok',
      total: 1,
      items: [{ id: 'person-1', name: 'Alice', isFavorite: false } as never],
    };

    expect(manager.results.map(({ kind }) => kind)).toContain('typed');
    expect(manager.results.map(({ kind }) => kind)).toContain('person');
    expect(manager.results.findIndex(({ kind }) => kind === 'typed')).toBeLessThan(
      manager.results.findIndex(({ kind }) => kind === 'person'),
    );
  });

  it('clears and refreshes typed suggestions when the caret changes tokens', async () => {
    vi.useFakeTimers();
    manager.query = 'person:alice tag:trip';
    manager.caret = 7;
    manager.typedSuggestions = {
      status: 'ok',
      key: 'person',
      total: 1,
      items: [
        {
          id: 'alice',
          key: 'person',
          label: 'Alice',
          value: 'Alice',
          tokenStart: 0,
          tokenEnd: 12,
        },
      ],
    };

    manager.setInputCaret(manager.query.length);
    expect(manager.typedSuggestions).toEqual({ status: 'idle' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.typedSuggestions.status).not.toBe('idle');
    vi.useRealTimers();
  });

  it('replays query recents immediately and removes highlighted recents', async () => {
    const activateSearch = vi.spyOn(manager, 'activateSearch').mockResolvedValue();
    const recent = {
      id: 'query:cats',
      kind: 'query' as const,
      label: 'cats',
      value: 'cats',
      lastUsed: 1,
    };
    await manager.activate({ id: 'recent:query:cats', kind: 'recent', item: recent });
    expect(activateSearch).toHaveBeenCalledWith('cats');

    manager.recents = [recent];
    manager.removeRecent(recent.id);
    expect(manager.recents).toEqual([]);
    expect(goto).not.toHaveBeenCalled();
  });
});
