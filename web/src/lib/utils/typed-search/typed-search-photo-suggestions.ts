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
  language?: string;
  signal?: AbortSignal;
};

const photoResultLimit = 5;

export async function resolveTypedSearchPhotoSuggestions({
  query,
  mode,
  language,
  signal,
}: TypedSearchPhotoContext): Promise<TypedSearchPhotoStatus> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { status: 'idle' };
  }

  try {
    const items =
      mode === 'smart'
        ? await searchSmartPhotos(normalizedQuery, language, signal)
        : await searchMetadataPhotos(normalizedQuery, mode, signal);
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

async function searchSmartPhotos(query: string, language?: string, signal?: AbortSignal) {
  const smartSearchDto: SmartSearchDto = {
    query,
    size: photoResultLimit,
    withExif: true,
    language,
  };
  const response = await searchSmart({ smartSearchDto }, { signal });
  return response.assets.items.slice(0, photoResultLimit);
}

async function searchMetadataPhotos(query: string, mode: Exclude<TypedSearchPhotoMode, 'smart'>, signal?: AbortSignal) {
  const metadataSearchDto: MetadataSearchDto = {
    size: photoResultLimit,
    withExif: true,
    ...(mode === 'metadata' ? { originalFileName: query } : {}),
    ...(mode === 'description' ? { description: query } : {}),
    ...(mode === 'fullPath' ? { originalPath: query } : {}),
    ...(mode === 'ocr' ? { ocr: query } : {}),
  };
  const response = await searchAssets({ metadataSearchDto }, { signal });
  return response.assets.items.slice(0, photoResultLimit);
}
