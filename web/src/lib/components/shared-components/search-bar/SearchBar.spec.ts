import {
  getAllPeople,
  getAllTags,
  getSearchSuggestions,
  searchAssets,
  searchPerson,
  searchSmart,
  SearchSuggestionType,
} from '@immich/sdk';
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
  searchAssets: vi.fn(),
  searchPerson: vi.fn(),
  searchSmart: vi.fn(),
}));

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('SearchBar inline filters', () => {
  const searchResponse = (items: Array<{ id: string; originalFileName: string; thumbhash?: string }>) =>
    ({
      assets: { items, count: items.length, total: items.length, nextPage: null, facets: [] },
      albums: { items: [], count: 0, total: 0, facets: [] },
    }) as never;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(goto).mockResolvedValue();
    localStorage.clear();
    sessionStorage.clear();
    searchStore.savedSearchTerms = [];
    vi.mocked(getAllPeople).mockResolvedValue({ people: [] } as never);
    vi.mocked(getAllTags).mockResolvedValue([]);
    vi.mocked(getSearchSuggestions).mockResolvedValue([]);
    vi.mocked(searchAssets).mockResolvedValue(searchResponse([]));
    vi.mocked(searchPerson).mockResolvedValue([]);
    vi.mocked(searchSmart).mockResolvedValue(searchResponse([]));
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

  it('surfaces live photo thumbnails beneath filter matches', async () => {
    const user = userEvent.setup();
    vi.mocked(searchPerson).mockResolvedValue([{ id: 'person-id', name: 'Pierre' }] as never);
    vi.mocked(searchSmart).mockResolvedValue(
      searchResponse([
        { id: 'asset-1', originalFileName: 'skyscraper-1.jpg', thumbhash: 'hash-1' },
        { id: 'asset-2', originalFileName: 'skyscraper-2.jpg', thumbhash: 'hash-2' },
      ]),
    );
    const { container } = render(SearchBarTest);
    const input = screen.getByRole('combobox');

    await user.type(input, 'skyscraper person:Pierre');

    expect(await screen.findByRole('option', { name: 'skyscraper-1.jpg' })).toBeInTheDocument();
    expect(screen.getByText('Photos')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'skyscraper-2.jpg' })).toBeInTheDocument();
    expect(searchSmart).toHaveBeenLastCalledWith(
      {
        smartSearchDto: expect.objectContaining({
          query: 'skyscraper',
          size: 5,
          withExif: true,
        }),
      },
      expect.anything(),
    );
    const thumbnail = container.querySelector('[data-typed-search-photos] img');
    expect(thumbnail?.getAttribute('src')).toContain('/api/assets/asset-1/thumbnail');
    expect(thumbnail?.getAttribute('src')).toContain('size=thumbnail');
  });

  it('opens a clicked or keyboard-selected photo', async () => {
    const user = userEvent.setup();
    vi.mocked(searchSmart).mockResolvedValue(
      searchResponse([
        { id: 'asset-1', originalFileName: 'tower-1.jpg' },
        { id: 'asset-2', originalFileName: 'tower-2.jpg' },
      ]),
    );
    render(SearchBarTest);
    const input = screen.getByRole('combobox');

    await user.type(input, 'tower');
    await user.click(await screen.findByRole('option', { name: 'tower-2.jpg' }));
    expect(goto).toHaveBeenLastCalledWith('/photos/asset-2');

    vi.mocked(goto).mockClear();
    await user.click(input);
    await user.keyboard('[ArrowDown][Enter]');
    expect(goto).toHaveBeenLastCalledWith('/photos/asset-1');
  });

  it('previews filter-only city results in OCR mode', async () => {
    const user = userEvent.setup();
    localStorage.setItem('searchQueryType', 'ocr');
    vi.mocked(getSearchSuggestions).mockResolvedValue(['Agoura']);
    vi.mocked(searchAssets).mockResolvedValue(searchResponse([{ id: 'asset-1', originalFileName: 'agoura.jpg' }]));
    render(SearchBarTest);

    await user.type(screen.getByRole('combobox'), 'city:Agoura');

    expect(await screen.findByRole('option', { name: 'agoura.jpg' })).toBeInTheDocument();
    expect(searchAssets).toHaveBeenLastCalledWith(
      {
        metadataSearchDto: {
          city: 'Agoura',
          size: 5,
          withExif: true,
        },
      },
      expect.anything(),
    );
  });

  it('previews filter-only person results after an exact resolution', async () => {
    const user = userEvent.setup();
    vi.mocked(searchPerson).mockResolvedValue([{ id: 'haris-id', name: 'Haris' }] as never);
    vi.mocked(searchAssets).mockResolvedValue(searchResponse([{ id: 'asset-1', originalFileName: 'haris.jpg' }]));
    render(SearchBarTest);

    await user.type(screen.getByRole('combobox'), 'person:haris');

    expect(await screen.findByRole('option', { name: 'haris.jpg' })).toBeInTheDocument();
    expect(searchAssets).toHaveBeenLastCalledWith(
      {
        metadataSearchDto: {
          personIds: ['haris-id'],
          size: 5,
          withExif: true,
        },
      },
      expect.anything(),
    );
  });

  it('shows no results found for an empty filtered preview', async () => {
    const user = userEvent.setup();
    vi.mocked(getSearchSuggestions).mockResolvedValue(['Agoura']);
    render(SearchBarTest);

    await user.type(screen.getByRole('combobox'), 'city:Agoura');

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(screen.getByText('Photos')).toBeInTheDocument();
  });
});

function getSearchPayload(url: string) {
  const query = new URL(url, 'http://localhost').searchParams.get('query');
  return JSON.parse(query ?? '{}');
}
