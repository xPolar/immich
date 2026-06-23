import { fireEvent, render } from '@testing-library/svelte';
import SearchDisplaySectionTest from '$lib/components/shared-components/search-bar/__test__/SearchDisplaySectionTest.svelte';

describe('SearchDisplaySection', () => {
  it('updates the stacked display filter', async () => {
    const sut = render(SearchDisplaySectionTest);
    const checkbox = sut.getByRole('checkbox', { name: 'stacked' });

    await fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
  });

  it('supports filtering favorites and non-favorites', async () => {
    const sut = render(SearchDisplaySectionTest);
    const all = sut.getByRole('radio', { name: 'all' });
    const favorites = sut.getByRole('radio', { name: 'favorites' });
    const notFavorites = sut.getByRole('radio', { name: 'search_filter_not_favorites' });

    expect(all).toBeChecked();
    await fireEvent.click(notFavorites);
    expect(notFavorites).toBeChecked();
    await fireEvent.click(favorites);
    expect(favorites).toBeChecked();
  });
});
