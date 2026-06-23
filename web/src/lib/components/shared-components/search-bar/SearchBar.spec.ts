import { getAllPeople, getAllTags, getSearchSuggestions, searchPerson } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goto } from '$app/navigation';
import { searchStore } from '$lib/stores/search.svelte';
import SearchBarTest from './__test__/SearchBarTest.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
  getAllPeople: vi.fn(),
  getAllTags: vi.fn(),
  getSearchSuggestions: vi.fn(),
  searchPerson: vi.fn(),
}));

describe('SearchBar inline filters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    searchStore.savedSearchTerms = [];
    vi.mocked(getAllPeople).mockResolvedValue({ people: [] } as never);
    vi.mocked(getAllTags).mockResolvedValue([]);
    vi.mocked(getSearchSuggestions).mockResolvedValue([]);
    vi.mocked(searchPerson).mockResolvedValue([]);
  });

  it('submits scalar filters with the plain search text', async () => {
    const user = userEvent.setup();
    render(SearchBarTest);

    await user.type(screen.getByRole('combobox'), 'beach type:video favorite:true rating:4{enter}');

    await waitFor(() => expect(goto).toHaveBeenCalledOnce());
    expect(getSearchPayload(vi.mocked(goto).mock.calls[0][0] as string)).toEqual({
      isFavorite: true,
      query: 'beach',
      rating: 4,
      type: 'VIDEO',
    });
  });

  it('selects a live person suggestion and submits its id', async () => {
    const user = userEvent.setup();
    vi.mocked(searchPerson).mockResolvedValue([{ id: 'person-id', name: 'Anna' }] as never);
    render(SearchBarTest);
    const input = screen.getByRole('combobox');

    await user.type(input, 'person:ann');
    await user.click(await screen.findByRole('option', { name: 'Anna' }));
    expect(input).toHaveValue('person:Anna');
    await user.type(input, '{enter}');

    await waitFor(() => expect(goto).toHaveBeenCalledOnce());
    expect(getSearchPayload(vi.mocked(goto).mock.calls[0][0] as string)).toEqual({ personIds: ['person-id'] });
  });

  it('keeps the search open when a filter is invalid', async () => {
    const user = userEvent.setup();
    render(SearchBarTest);

    await user.type(screen.getByRole('combobox'), 'rating:9{enter}');

    expect(await screen.findByText('Rating must be between 1 and 5')).toBeInTheDocument();
    expect(goto).not.toHaveBeenCalled();
  });
});

function getSearchPayload(url: string) {
  const query = new URL(url, 'http://localhost').searchParams.get('query');
  return JSON.parse(query ?? '{}');
}
