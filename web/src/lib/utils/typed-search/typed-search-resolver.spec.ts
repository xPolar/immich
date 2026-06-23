import { getAllTags, getSearchSuggestions, searchPerson, SearchSuggestionType } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTypedSearch } from './typed-search-parser';
import { resolveTypedSearchFilters } from './typed-search-resolver';

vi.mock('@immich/sdk', () => ({
  AssetTypeEnum: { Image: 'IMAGE', Video: 'VIDEO' },
  getAllTags: vi.fn(),
  getSearchSuggestions: vi.fn(),
  searchPerson: vi.fn(),
  SearchSuggestionType: {
    CameraMake: 'camera-make',
    CameraModel: 'camera-model',
    City: 'city',
    Country: 'country',
  },
}));

describe('resolveTypedSearchFilters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(searchPerson).mockResolvedValue([{ id: 'person-id', name: 'Anna' }] as never);
    vi.mocked(getAllTags).mockResolvedValue([{ id: 'tag-id', value: 'Travel' }] as never);
    vi.mocked(getSearchSuggestions).mockImplementation(({ $type }) => {
      switch ($type) {
        case SearchSuggestionType.CameraMake: {
          return Promise.resolve(['Nikon']);
        }
        case SearchSuggestionType.CameraModel: {
          return Promise.resolve(['D850']);
        }
        case SearchSuggestionType.Country: {
          return Promise.resolve(['Germany']);
        }
        case SearchSuggestionType.City: {
          return Promise.resolve(['Berlin']);
        }
        default: {
          return Promise.resolve([]);
        }
      }
    });
  });

  it('maps inline filters to the Immich search DTO', async () => {
    const parsed = parseTypedSearch(
      'beach person:anna tag:travel country:germany city:berlin from:2025 to:2025-02 type:photo favorite:false rating:4 camera:nikon',
    );
    const result = await resolveTypedSearchFilters(parsed);

    expect(result).toMatchObject({
      ok: true,
      filters: {
        city: 'Berlin',
        country: 'Germany',
        isFavorite: false,
        make: 'Nikon',
        personIds: ['person-id'],
        rating: 4,
        tagIds: ['tag-id'],
        takenAfter: expect.stringContaining('2025-01-01T00:00:00'),
        takenBefore: expect.stringContaining('2025-02-28T23:59:59'),
        type: 'IMAGE',
      },
    });
  });

  it('returns choices when an entity filter is ambiguous', async () => {
    vi.mocked(searchPerson).mockResolvedValue([
      { id: 'anna-id', name: 'Anna' },
      { id: 'annabelle-id', name: 'Annabelle' },
    ] as never);

    const result = await resolveTypedSearchFilters(parseTypedSearch('person:ann'));

    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'ambiguous', key: 'person' })],
      choices: [
        expect.objectContaining({ id: 'anna-id', label: 'Anna' }),
        expect.objectContaining({ id: 'annabelle-id', label: 'Annabelle' }),
      ],
    });
  });

  it('uses a previously selected entity choice', async () => {
    vi.mocked(searchPerson).mockResolvedValue([
      { id: 'anna-id', name: 'Anna' },
      { id: 'other-anna-id', name: 'Anna' },
    ] as never);
    const selected = new Map([
      [
        'person:Anna',
        {
          tokenRaw: 'person:Anna',
          key: 'person' as const,
          id: 'other-anna-id',
          label: 'Anna',
          value: 'Anna',
        },
      ],
    ]);

    const result = await resolveTypedSearchFilters(parseTypedSearch('person:Anna'), { selectedChoices: selected });

    expect(result).toMatchObject({ ok: true, filters: { personIds: ['other-anna-id'] } });
  });

  it('reports entity filters that do not match', async () => {
    vi.mocked(getAllTags).mockResolvedValue([]);

    const result = await resolveTypedSearchFilters(parseTypedSearch('tag:missing'));

    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'no-match', key: 'tag' })],
      choices: [],
    });
  });
});
