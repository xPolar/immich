import { searchAssets, searchSmart } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTypedSearchPhotoSuggestions } from './typed-search-photo-suggestions';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  searchAssets: vi.fn(),
  searchSmart: vi.fn(),
}));

const searchResponse = (items: Array<{ id: string; originalFileName: string }>) =>
  ({
    assets: { items, count: items.length, total: items.length, nextPage: null, facets: [] },
    albums: { items: [], count: 0, total: 0, facets: [] },
  }) as never;

describe('resolveTypedSearchPhotoSuggestions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(searchSmart).mockResolvedValue(searchResponse([]));
    vi.mocked(searchAssets).mockResolvedValue(searchResponse([]));
  });

  it('returns idle without a plain query', async () => {
    await expect(resolveTypedSearchPhotoSuggestions({ query: ' ', mode: 'smart' })).resolves.toEqual({
      status: 'idle',
    });
    expect(searchSmart).not.toHaveBeenCalled();
    expect(searchAssets).not.toHaveBeenCalled();
  });

  it('returns up to five smart-search photos', async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `asset-${index}`,
      originalFileName: `building-${index}.jpg`,
    }));
    vi.mocked(searchSmart).mockResolvedValue(searchResponse(items));

    const result = await resolveTypedSearchPhotoSuggestions({
      query: ' skyscraper ',
      mode: 'smart',
      language: 'en-US',
    });

    expect(searchSmart).toHaveBeenCalledWith(
      { smartSearchDto: { query: 'skyscraper', size: 5, withExif: true, language: 'en-US' } },
      { signal: undefined },
    );
    expect(result).toMatchObject({ status: 'ok', total: 5 });
    if (result.status === 'ok') {
      expect(result.items.map((item) => item.id)).toEqual(['asset-0', 'asset-1', 'asset-2', 'asset-3', 'asset-4']);
    }
  });

  it.each([
    ['metadata', { originalFileName: 'tower' }],
    ['description', { description: 'tower' }],
    ['fullPath', { originalPath: 'tower' }],
    ['ocr', { ocr: 'tower' }],
  ] as const)('uses the %s metadata field', async (mode, expected) => {
    vi.mocked(searchAssets).mockResolvedValue(searchResponse([{ id: 'asset-1', originalFileName: 'tower.jpg' }]));

    await resolveTypedSearchPhotoSuggestions({ query: 'tower', mode });

    expect(searchAssets).toHaveBeenCalledWith(
      { metadataSearchDto: { size: 5, withExif: true, ...expected } },
      { signal: undefined },
    );
  });

  it('returns a quiet error and rethrows aborts', async () => {
    vi.mocked(searchSmart).mockRejectedValueOnce(new Error('ML unavailable'));

    await expect(resolveTypedSearchPhotoSuggestions({ query: 'tower', mode: 'smart' })).resolves.toEqual({
      status: 'error',
      message: 'ML unavailable',
    });

    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    vi.mocked(searchSmart).mockRejectedValueOnce(abortError);
    await expect(resolveTypedSearchPhotoSuggestions({ query: 'tower', mode: 'smart' })).rejects.toBe(abortError);
  });
});
