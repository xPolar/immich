import { getAllPeople, getAllTags, getSearchSuggestions, searchPerson, SearchSuggestionType } from '@immich/sdk';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('SearchBar inline filters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    sessionStorage.clear();
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
    expect(sessionStorage.getItem(`typed-search:display:${vi.mocked(goto).mock.calls[0][0]}`)).toBe(
      'beach type:video favorite:true rating:4',
    );
  });

  it('selects a live person suggestion and submits its id', async () => {
    const user = userEvent.setup();
    vi.mocked(searchPerson).mockResolvedValue([{ id: 'person-id', name: 'Anna' }] as never);
    render(SearchBarTest);
    const input = screen.getByRole('combobox');

    await user.type(input, 'person:ann');
    await user.click(await screen.findByRole('option', { name: 'Anna' }));
    expect(input).toHaveValue('person:Anna ');
    expect(screen.getByTestId('typed-search-token-person')).toHaveAttribute('data-status', 'resolved-entity');
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

  it('shows substantial live filter rows and auto-selects the first keyboard choice', async () => {
    const user = userEvent.setup();
    vi.mocked(getAllPeople).mockResolvedValue({
      people: [
        { id: 'anna-id', name: 'Anna' },
        { id: 'beth-id', name: 'Beth' },
      ],
    } as never);
    render(SearchBarTest);
    const input = screen.getByRole('combobox');

    await user.type(input, 'person:');

    expect(await screen.findByText('person filter matches')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'Anna' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Use as filter')).toHaveLength(2);
    await user.keyboard('[ArrowDown][Enter]');
    expect(input).toHaveValue('person:Beth ');
  });

  it('resolves cameras on submit and asks for a choice when ambiguous', async () => {
    const user = userEvent.setup();
    vi.mocked(getSearchSuggestions).mockImplementation(({ $type }) => {
      if ($type === SearchSuggestionType.CameraMake) {
        return Promise.resolve(['Nikon']);
      }
      if ($type === SearchSuggestionType.CameraModel) {
        return Promise.resolve(['Nikon Z8']);
      }
      return Promise.resolve([]);
    });
    render(SearchBarTest);
    const input = screen.getByRole('combobox');

    await user.type(input, 'camera:nik{enter}');

    expect(await screen.findByText('Choose a camera for "nik"')).toBeInTheDocument();
    expect(screen.getByText('Choose a filter match')).toBeInTheDocument();
    expect(goto).not.toHaveBeenCalled();
    await user.click(screen.getByRole('option', { name: 'Nikon Z8' }));
    expect(input).toHaveValue('camera:nik');
    expect(screen.getByTestId('typed-search-token-camera')).toHaveAttribute('data-status', 'resolved-entity');
    await user.type(input, '{enter}');

    await waitFor(() => expect(goto).toHaveBeenCalledOnce());
    expect(getSearchPayload(vi.mocked(goto).mock.calls[0][0] as string)).toEqual({ model: 'Nikon Z8' });
  });

  it('renders every commit validation issue instead of collapsing to the first', async () => {
    const user = userEvent.setup();
    render(SearchBarTest);

    await user.type(screen.getByRole('combobox'), 'rating:9 type:gif{enter}');

    expect(await screen.findByText('Rating must be between 1 and 5')).toBeInTheDocument();
    expect(screen.getByText('Type must be photo, image, or video')).toBeInTheDocument();
    expect(screen.getByTestId('typed-search-token-rating')).toHaveAttribute('data-status', 'error');
    expect(screen.getByTestId('typed-search-token-type')).toHaveAttribute('data-status', 'error');
  });
});

function getSearchPayload(url: string) {
  const query = new URL(url, 'http://localhost').searchParams.get('query');
  return JSON.parse(query ?? '{}');
}
