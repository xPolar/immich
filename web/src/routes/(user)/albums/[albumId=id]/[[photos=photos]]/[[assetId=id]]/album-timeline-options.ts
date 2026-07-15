import { AssetVisibility, type AssetOrder } from '@immich/sdk';
import { AlbumPageViewMode } from '$lib/constants';
import type { TimelineManagerOptions } from '$lib/managers/timeline-manager/types';

export const getAlbumTimelineOptions = (
  viewMode: AlbumPageViewMode,
  albumId: string,
  order: AssetOrder | undefined,
): TimelineManagerOptions => {
  if (viewMode === AlbumPageViewMode.SELECT_ASSETS) {
    return {
      visibility: AssetVisibility.Timeline,
      withPartners: true,
      timelineAlbumId: albumId,
    };
  }

  return { albumId, order, withStacked: true };
};
