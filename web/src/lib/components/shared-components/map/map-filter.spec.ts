import { AssetTypeEnum } from '@immich/sdk';
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { MediaType } from '$lib/constants';
import { createMapFilterState, getActiveMapFilterCount, toMapMarkerFilters } from './map-filter';

describe('map filters', () => {
  it('should convert active filters into map marker request options', () => {
    const filters = createMapFilterState();
    filters.personIds.add('11111111-1111-4111-8111-111111111111');
    filters.tagIds?.add('22222222-2222-4222-8222-222222222222');
    filters.camera = { make: 'Canon', model: 'EOS R5', lensModel: 'RF24-70mm' };
    filters.date = {
      takenAfter: DateTime.fromISO('2024-06-01'),
      takenBefore: DateTime.fromISO('2024-06-30'),
    };
    filters.isFavorite = true;
    filters.mediaType = MediaType.Image;
    filters.rating = 4;

    expect(toMapMarkerFilters(filters)).toEqual({
      personIds: ['11111111-1111-4111-8111-111111111111'],
      tagIds: ['22222222-2222-4222-8222-222222222222'],
      make: 'Canon',
      model: 'EOS R5',
      lensModel: 'RF24-70mm',
      takenAfter: expect.stringContaining('2024-06-01T00:00:00'),
      takenBefore: expect.stringContaining('2024-06-30T23:59:59'),
      isFavorite: true,
      rating: 4,
      isUnrated: undefined,
      $type: AssetTypeEnum.Image,
    });
    expect(getActiveMapFilterCount(filters)).toBe(7);
  });

  it('should represent the unrated selection separately from no rating filter', () => {
    const filters = createMapFilterState();

    expect(toMapMarkerFilters(filters).rating).toBeUndefined();
    expect(toMapMarkerFilters(filters).isUnrated).toBeUndefined();

    filters.rating = null;

    expect(toMapMarkerFilters(filters).rating).toBeUndefined();
    expect(toMapMarkerFilters(filters).isUnrated).toBe(true);
  });
});
