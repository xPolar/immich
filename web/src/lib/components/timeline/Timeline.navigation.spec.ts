import { waitFor } from '@testing-library/svelte';
import { afterNavigate } from '$app/navigation';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { focusAsset } from '$lib/components/timeline/actions/focus-actions';
import { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { assetViewerManager } from '$lib/managers/asset-viewer-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import type { TimelineMonth } from '$lib/managers/timeline-manager/timeline-month.svelte';
import { fromISODateTimeUTCToObject } from '$lib/utils/timeline-util';
import { renderWithTooltips } from '$tests/helpers';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import Timeline from './Timeline.svelte';

vi.mock('$app/navigation', () => ({ afterNavigate: vi.fn(), beforeNavigate: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/elements/HotModuleReload.svelte', () => ({ default: () => {} }));
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/photos'),
    route: { id: '/(user)/photos/[[assetId=id]]' },
    params: {},
    data: {},
  },
}));
vi.mock('$lib/components/timeline/actions/focus-actions', async (original) => ({
  ...(await original<typeof import('$lib/components/timeline/actions/focus-actions')>()),
  focusAsset: vi.fn(),
}));

describe('Timeline exact-position navigation', () => {
  let assetInteraction: AssetMultiSelectManager;
  const month = {
    findAssetAbsolutePosition: () => ({ top: 600, left: 0, width: 100, height: 100 }),
  } as unknown as TimelineMonth;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', getResizeObserverMock());
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    authManager.setPreferences(preferencesFactory.build());
    assetInteraction = new AssetMultiSelectManager();
    assetViewerManager.gridScrollTarget = { at: 'exact-asset', atTime: '2024-06-15T12:30:59.987' };
  });

  afterEach(() => {
    assetInteraction.destroy();
    assetViewerManager.gridScrollTarget = undefined;
    authManager.reset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the exact asset without replacing it with a timestamp match', async () => {
    const lookup = vi.spyOn(TimelineManager.prototype, 'findTimelineMonthForAsset').mockResolvedValue(month);
    const closest = vi.spyOn(TimelineManager.prototype, 'getClosestAssetToDate');
    renderWithTooltips(Timeline, { enableRouting: true, assetInteraction, options: {} });

    vi.mocked(afterNavigate).mock.calls[0][0]({ complete: Promise.resolve() } as never);

    await waitFor(() => expect(focusAsset).toHaveBeenCalledWith('exact-asset'));
    expect(lookup).toHaveBeenCalledWith({ id: 'exact-asset' });
    expect(closest).not.toHaveBeenCalled();
  });

  it('falls back to the full timestamp when the photo is not in this timeline', async () => {
    const fallback = timelineAssetFactory.build({ id: 'nearby-asset' });
    vi.spyOn(TimelineManager.prototype, 'findTimelineMonthForAsset')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(month);
    const closest = vi.spyOn(TimelineManager.prototype, 'getClosestAssetToDate').mockResolvedValue(fallback);
    renderWithTooltips(Timeline, { enableRouting: true, assetInteraction, options: {} });

    vi.mocked(afterNavigate).mock.calls[0][0]({ complete: Promise.resolve() } as never);

    await waitFor(() => expect(focusAsset).toHaveBeenCalledWith('nearby-asset'));
    expect(closest).toHaveBeenCalledWith(fromISODateTimeUTCToObject('2024-06-15T12:30:59.987'), {
      preferSameDay: false,
    });
  });

  it('keeps legacy day-only links working', async () => {
    assetViewerManager.gridScrollTarget = { at: '2024-06-15' };
    const fallback = timelineAssetFactory.build({ id: 'day-asset' });
    const lookup = vi.spyOn(TimelineManager.prototype, 'findTimelineMonthForAsset').mockResolvedValue(month);
    const closest = vi.spyOn(TimelineManager.prototype, 'getClosestAssetToDate').mockResolvedValue(fallback);
    renderWithTooltips(Timeline, { enableRouting: true, assetInteraction, options: {} });

    vi.mocked(afterNavigate).mock.calls[0][0]({ complete: Promise.resolve() } as never);

    await waitFor(() => expect(focusAsset).toHaveBeenCalledWith('day-asset'));
    expect(closest).toHaveBeenCalledWith(fromISODateTimeUTCToObject('2024-06-15'), { preferSameDay: true });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith({ id: 'day-asset' });
  });
});
