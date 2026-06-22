import { fireEvent, render } from '@testing-library/svelte';
import SearchDisplaySectionTest from '$lib/components/shared-components/search-bar/__test__/SearchDisplaySectionTest.svelte';

describe('SearchDisplaySection', () => {
  it('updates the stacked display filter', async () => {
    const sut = render(SearchDisplaySectionTest);
    const checkbox = sut.getByRole('checkbox', { name: 'stacked' });

    await fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
  });
});
