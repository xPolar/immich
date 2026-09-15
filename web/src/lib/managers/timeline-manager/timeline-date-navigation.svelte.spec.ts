import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { fromISODateTimeUTCToObject } from '$lib/utils/timeline-util';
import { timelineAssetFactory, toResponseDto } from '@test-data/factories/asset-factory';
import { TimelineManager } from './timeline-manager.svelte';

describe('timeline date navigation', () => {
  let timelineManager: TimelineManager;
  const assets = ['2024-06-15T18:00:00Z', '2024-06-15T12:00:00Z', '2024-06-14T23:59:00Z'].map((date) =>
    timelineAssetFactory.build({
      localDateTime: fromISODateTimeUTCToObject(date),
      fileCreatedAt: fromISODateTimeUTCToObject(date),
    }),
  );

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getTimeBuckets.mockResolvedValue([{ count: assets.length, timeBucket: '2024-06-01' }]);
    sdkMock.getTimeBucket.mockResolvedValue(toResponseDto(...assets));
    timelineManager = new TimelineManager();
  });

  afterEach(() => {
    timelineManager.destroy();
  });

  it('waits for initialization and selects a photo on the requested day instead of the previous night', async () => {
    const pending = timelineManager.getClosestAssetToDate(fromISODateTimeUTCToObject('2024-06-15'), {
      preferSameDay: true,
    });
    await timelineManager.updateViewport({ width: 1588, height: 1000 });

    const asset = await pending;
    expect(asset?.id).toBe(assets[0].id);
  });

  it('keeps the existing closest-time behavior when same-day preference is not requested', async () => {
    await timelineManager.updateViewport({ width: 1588, height: 1000 });

    const asset = await timelineManager.getClosestAssetToDate(fromISODateTimeUTCToObject('2024-06-15'));

    expect(asset?.id).toBe(assets[2].id);
  });

  it('uses hours and minutes to find the nearest photo rather than the first photo of the day', async () => {
    await timelineManager.updateViewport({ width: 1588, height: 1000 });

    const asset = await timelineManager.getClosestAssetToDate(fromISODateTimeUTCToObject('2024-06-15T12:01:00'));

    expect(asset?.id).toBe(assets[1].id);
  });

  it('retains seconds and milliseconds when choosing between nearby photos', async () => {
    const closeAssets = ['2024-06-15T12:30:02.900Z', '2024-06-15T12:30:02.100Z', '2024-06-15T12:30:01.900Z'].map(
      (date) =>
        timelineAssetFactory.build({
          localDateTime: fromISODateTimeUTCToObject(date),
          fileCreatedAt: fromISODateTimeUTCToObject(date),
        }),
    );
    sdkMock.getTimeBucket.mockResolvedValue(toResponseDto(...closeAssets));
    await timelineManager.updateViewport({ width: 1588, height: 1000 });

    const asset = await timelineManager.getClosestAssetToDate(fromISODateTimeUTCToObject('2024-06-15T12:30:02.110'));

    expect(asset?.id).toBe(closeAssets[1].id);
  });

  it('falls back to available photos when the requested date is absent', async () => {
    await timelineManager.updateViewport({ width: 1588, height: 1000 });

    const asset = await timelineManager.getClosestAssetToDate(fromISODateTimeUTCToObject('2024-06-20'), {
      preferSameDay: true,
    });

    expect(asset?.id).toBe(assets[0].id);
  });

  it('loads the nearest available month when the requested month is absent', async () => {
    await timelineManager.updateViewport({ width: 1588, height: 1000 });
    const load = vi.spyOn(timelineManager, 'loadTimelineMonth');

    const asset = await timelineManager.getClosestAssetToDate(fromISODateTimeUTCToObject('2024-07-15'), {
      preferSameDay: true,
    });

    expect(load).toHaveBeenCalledWith({ year: 2024, month: 6 }, { cancelable: false });
    expect(asset?.id).toBe(assets[0].id);
  });

  it('handles an empty gallery', async () => {
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    await timelineManager.updateViewport({ width: 1588, height: 1000 });

    const asset = await timelineManager.getClosestAssetToDate(fromISODateTimeUTCToObject('2024-06-15'), {
      preferSameDay: true,
    });

    expect(asset).toBeUndefined();
  });
});
