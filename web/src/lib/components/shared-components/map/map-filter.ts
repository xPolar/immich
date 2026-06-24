import { AssetTypeEnum } from '@immich/sdk';
import type { DateTime } from 'luxon';
import { SvelteSet } from 'svelte/reactivity';
import { MediaType } from '$lib/constants';
import type { SearchCameraFilter, SearchDateFilter } from '$lib/types';
import { asLocalTimeISO } from '$lib/utils/date-time';

export type MapFilterState = {
  personIds: SvelteSet<string>;
  tagIds: SvelteSet<string> | null;
  camera: SearchCameraFilter;
  date: SearchDateFilter;
  isFavorite: boolean;
  mediaType: MediaType;
  rating?: number | null;
};

export type MapMarkerFilters = {
  personIds?: string[];
  tagIds?: string[];
  make?: string;
  model?: string;
  lensModel?: string;
  takenAfter?: string;
  takenBefore?: string;
  isFavorite?: boolean;
  rating?: number;
  isUnrated?: boolean;
  $type?: AssetTypeEnum;
};

export const createMapFilterState = (): MapFilterState => ({
  personIds: new SvelteSet(),
  tagIds: new SvelteSet(),
  camera: {},
  date: {},
  isFavorite: false,
  mediaType: MediaType.All,
  rating: undefined,
});

export const getActiveMapFilterCount = (filters: MapFilterState) =>
  [
    filters.personIds.size > 0,
    (filters.tagIds?.size ?? 0) > 0,
    !!(filters.camera.make || filters.camera.model || filters.camera.lensModel),
    !!(filters.date.takenAfter || filters.date.takenBefore),
    filters.isFavorite,
    filters.mediaType !== MediaType.All,
    filters.rating !== undefined,
  ].filter(Boolean).length;

export const toMapMarkerFilters = (filters: MapFilterState): MapMarkerFilters => ({
  personIds: filters.personIds.size > 0 ? [...filters.personIds] : undefined,
  tagIds: filters.tagIds && filters.tagIds.size > 0 ? [...filters.tagIds] : undefined,
  make: filters.camera.make || undefined,
  model: filters.camera.model || undefined,
  lensModel: filters.camera.lensModel || undefined,
  takenAfter: filters.date.takenAfter
    ? asLocalTimeISO(filters.date.takenAfter.startOf('day') as DateTime<true>)
    : undefined,
  takenBefore: filters.date.takenBefore
    ? asLocalTimeISO(filters.date.takenBefore.endOf('day') as DateTime<true>)
    : undefined,
  isFavorite: filters.isFavorite || undefined,
  rating: typeof filters.rating === 'number' ? filters.rating : undefined,
  isUnrated: filters.rating === null || undefined,
  $type:
    filters.mediaType === MediaType.Image
      ? AssetTypeEnum.Image
      : filters.mediaType === MediaType.Video
        ? AssetTypeEnum.Video
        : undefined,
});
