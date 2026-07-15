import { AssetOrder, AssetVisibility } from '@immich/sdk';
import { AlbumPageViewMode } from '$lib/constants';
import { getAlbumTimelineOptions } from './album-timeline-options';

describe(getAlbumTimelineOptions.name, () => {
  it('requests collapsed stacks when viewing an album', () => {
    expect(getAlbumTimelineOptions(AlbumPageViewMode.VIEW, 'album-id', AssetOrder.Asc)).toEqual({
      albumId: 'album-id',
      order: AssetOrder.Asc,
      withStacked: true,
    });
  });

  it('keeps all assets available when selecting assets to add', () => {
    expect(getAlbumTimelineOptions(AlbumPageViewMode.SELECT_ASSETS, 'album-id', AssetOrder.Desc)).toEqual({
      visibility: AssetVisibility.Timeline,
      withPartners: true,
      timelineAlbumId: 'album-id',
    });
  });
});
