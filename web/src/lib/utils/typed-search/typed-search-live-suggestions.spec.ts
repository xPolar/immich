import { getAllPeople, getAllTags, getSearchSuggestions, searchPerson, SearchSuggestionType } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLiveTypedSearchSuggestions } from './typed-search-live-suggestions';
import { parseTypedSearch } from './typed-search-parser';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  getAllPeople: vi.fn(),
  getAllTags: vi.fn(),
  getSearchSuggestions: vi.fn(),
  searchPerson: vi.fn(),
}));

describe('resolveLiveTypedSearchSuggestions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAllPeople).mockResolvedValue({ people: [] } as never);
    vi.mocked(getAllTags).mockResolvedValue([]);
    vi.mocked(getSearchSuggestions).mockResolvedValue([]);
    vi.mocked(searchPerson).mockResolvedValue([]);
  });

  it('returns idle for camera tokens, which resolve on submit', async () => {
    const parsed = parseTypedSearch('camera:nik', { mode: 'draft' });

    await expect(resolveLiveTypedSearchSuggestions({ parsed, activeToken: parsed.tokens[0] })).resolves.toEqual({
      status: 'idle',
    });
  });

  it('searches people with stable choice spans and preview data', async () => {
    vi.mocked(searchPerson).mockResolvedValue([
      { id: 'person-1', name: 'Anna Maria' },
      { id: 'person-2', name: 'Annika' },
    ] as never);
    const parsed = parseTypedSearch('beach person:ann', { mode: 'draft' });

    const result = await resolveLiveTypedSearchSuggestions({ parsed, activeToken: parsed.tokens[0] });

    expect(searchPerson).toHaveBeenCalledWith({ name: 'ann', withHidden: false }, expect.anything());
    expect(result).toMatchObject({
      status: 'ok',
      key: 'person',
      total: 2,
      items: [
        {
          id: 'person:6:16:person-1',
          key: 'person',
          label: 'Anna Maria',
          value: 'Anna Maria',
          tokenStart: 6,
          tokenEnd: 16,
          entityId: 'person-1',
          preview: { kind: 'person', data: { id: 'person-1', name: 'Anna Maria' } },
        },
        expect.objectContaining({ label: 'Annika', entityId: 'person-2' }),
      ],
    });
  });

  it('loads initial named people for an empty token', async () => {
    vi.mocked(getAllPeople).mockResolvedValue({
      people: [
        { id: 'person-1', name: 'Zoe' },
        { id: 'person-2', name: '' },
      ],
    } as never);
    const parsed = parseTypedSearch('person:', { mode: 'draft' });

    const result = await resolveLiveTypedSearchSuggestions({ parsed, activeToken: parsed.tokens[0] });

    expect(getAllPeople).toHaveBeenCalledWith({ size: 100, withHidden: false }, expect.anything());
    expect(result).toMatchObject({ status: 'ok', key: 'person', total: 1 });
    if (result.status === 'ok') {
      expect(result.items.map((item) => item.label)).toEqual(['Zoe']);
    }
  });

  it('returns quiet person errors and rethrows aborts', async () => {
    const parsed = parseTypedSearch('person:ann', { mode: 'draft' });
    vi.mocked(searchPerson).mockRejectedValueOnce(new Error('network down'));

    await expect(resolveLiveTypedSearchSuggestions({ parsed, activeToken: parsed.tokens[0] })).resolves.toEqual({
      status: 'error',
      key: 'person',
      message: 'network down',
    });

    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.mocked(searchPerson).mockRejectedValueOnce(abortError);
    await expect(resolveLiveTypedSearchSuggestions({ parsed, activeToken: parsed.tokens[0] })).rejects.toBe(abortError);
  });

  it('loads and narrows tags', async () => {
    vi.mocked(getAllTags).mockResolvedValue([
      { id: 'tag-1', value: 'Travel' },
      { id: 'tag-2', value: 'Work' },
      { id: 'tag-3', value: 'Family/Travel' },
    ] as never);
    const parsed = parseTypedSearch('beach tag:trav', { mode: 'draft' });

    const result = await resolveLiveTypedSearchSuggestions({ parsed, activeToken: parsed.tokens[0] });

    expect(result).toMatchObject({ status: 'ok', key: 'tag', total: 2 });
    if (result.status === 'ok') {
      expect(result.items.map((item) => item.label)).toEqual(['Travel', 'Family/Travel']);
    }
  });

  it('loads and narrows countries', async () => {
    vi.mocked(getSearchSuggestions).mockResolvedValue(['Germany', 'Georgia', 'France']);
    const parsed = parseTypedSearch('country:ge', { mode: 'draft' });

    const result = await resolveLiveTypedSearchSuggestions({ parsed, activeToken: parsed.tokens[0] });

    expect(getSearchSuggestions).toHaveBeenCalledWith({ $type: SearchSuggestionType.Country }, expect.anything());
    expect(result).toMatchObject({ status: 'ok', key: 'country', total: 2 });
    if (result.status === 'ok') {
      expect(result.items.map((item) => item.value)).toEqual(['Germany', 'Georgia']);
    }
  });

  it('scopes city suggestions to the canonical country', async () => {
    vi.mocked(getSearchSuggestions).mockImplementation(({ $type }) =>
      Promise.resolve($type === SearchSuggestionType.Country ? ['Germany'] : ['Berlin']),
    );
    const parsed = parseTypedSearch('country:germany city:ber', { mode: 'draft' });

    const result = await resolveLiveTypedSearchSuggestions({ parsed, activeToken: parsed.tokens[1] });

    expect(getSearchSuggestions).toHaveBeenLastCalledWith(
      { $type: SearchSuggestionType.City, country: 'Germany' },
      expect.anything(),
    );
    expect(result).toMatchObject({
      status: 'ok',
      key: 'city',
      items: [expect.objectContaining({ label: 'Berlin', secondaryLabel: 'Germany' })],
    });
  });
});
