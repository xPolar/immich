import { beforeEach, describe, expect, it } from 'vitest';
import { getTypedSearchDisplayText, storeTypedSearchDisplayText } from './typed-search-display-cache';

describe('typed search display cache', () => {
  beforeEach(() => sessionStorage.clear());

  it('restores the typed expression for the resulting search URL', () => {
    const destination = '/search?query=filters';

    storeTypedSearchDisplayText(destination, ' beach person:Anna ');

    expect(getTypedSearchDisplayText(destination)).toBe('beach person:Anna');
    expect(getTypedSearchDisplayText('/search?query=other')).toBeUndefined();
  });
});
