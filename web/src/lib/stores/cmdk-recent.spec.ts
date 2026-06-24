import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addGlobalSearchRecent,
  clearGlobalSearchRecents,
  getGlobalSearchRecents,
  removeGlobalSearchRecent,
} from './cmdk-recent';

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { authenticated: true, user: { id: 'user-1' } },
}));

describe('global search recents', () => {
  beforeEach(clearGlobalSearchRecents);

  it('stores, deduplicates, and removes user-scoped entries', () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1).mockReturnValueOnce(2);
    addGlobalSearchRecent({ id: 'query:cats', kind: 'query', label: 'cats', value: 'cats' });
    addGlobalSearchRecent({ id: 'query:cats', kind: 'query', label: 'Cats', value: 'Cats' });

    expect(getGlobalSearchRecents()).toMatchObject([{ id: 'query:cats', label: 'Cats', lastUsed: 2 }]);
    removeGlobalSearchRecent('query:cats');
    expect(getGlobalSearchRecents()).toEqual([]);
  });
});
