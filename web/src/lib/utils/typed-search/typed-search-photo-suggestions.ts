import {
  searchAssets,
  searchSmart,
  type AssetResponseDto,
  type MetadataSearchDto,
  type SmartSearchDto,
} from '@immich/sdk';

export type TypedSearchPhotoMode = 'smart' | 'metadata' | 'description' | 'fullPath' | 'ocr';

export type TypedSearchPhotoStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; items: AssetResponseDto[]; total: number }
  | { status: 'empty' }
  | { status: 'timeout' }
  | { status: 'error'; message: string };

export type TypedSearchPhotoContext = {
  query: string;
  mode: TypedSearchPhotoMode;
  filters?: SmartSearchDto;
  language?: string;
  signal?: AbortSignal;
};

const photoResultLimit = 5;

export async function resolveTypedSearchPhotoSuggestions({
  query,
  mode,
  filters = {},
  language,
  signal,
}: TypedSearchPhotoContext): Promise<TypedSearchPhotoStatus> {
  const normalizedQuery = query.trim();
  const hasFilters = Object.keys(filters).length > 0;
  if (!normalizedQuery && !hasFilters) {
    return { status: 'idle' };
  }

  try {
    const items =
      mode === 'smart' && normalizedQuery
        ? await searchSmartPhotos(normalizedQuery, filters, language, signal)
        : await searchMetadataPhotos(normalizedQuery, mode, filters, signal);
    return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unable to load photo matches',
    };
  }
}

async function searchSmartPhotos(query: string, filters: SmartSearchDto, language?: string, signal?: AbortSignal) {
  const smartSearchDto: SmartSearchDto = {
    ...filters,
    query,
    size: photoResultLimit,
    withExif: true,
    language,
  };
  const response = await searchSmart({ smartSearchDto }, { signal });
  return response.assets.items.slice(0, photoResultLimit);
}

async function searchMetadataPhotos(
  query: string,
  mode: TypedSearchPhotoMode,
  filters: SmartSearchDto,
  signal?: AbortSignal,
) {
  const metadataSearchDto: MetadataSearchDto = {
    ...filters,
    size: photoResultLimit,
    withExif: true,
    ...(query && mode === 'metadata' ? { originalFileName: query } : {}),
    ...(query && mode === 'description' ? { description: query } : {}),
    ...(query && mode === 'fullPath' ? { originalPath: query } : {}),
    ...(query && mode === 'ocr' ? { ocr: query } : {}),
  };
  const response = await searchAssets({ metadataSearchDto }, { signal });
  return response.assets.items.slice(0, photoResultLimit);
}
