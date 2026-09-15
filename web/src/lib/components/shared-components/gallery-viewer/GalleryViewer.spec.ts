import { waitFor } from '@testing-library/svelte';
import { afterNavigate } from '$app/navigation';
import { page } from '$app/state';
import { getResizeObserverMock } from '$lib/__mocks__/resize-observer.mock';
import { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { getJustifiedLayoutFromAssets } from '$lib/utils/layout-utils';
import { renderWithTooltips } from '$tests/helpers';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import GalleryViewer from './GalleryViewer.svelte';

vi.mock('$app/navigation', () => ({ afterNavigate: vi.fn(), goto: vi.fn() }));
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/search?at=2024-06-15'),
    route: { id: '/(user)/search/[[photos=photos]]/[[assetId=id]]' },
    data: {},
    params: {},
  },
}));

describe('GalleryViewer date navigation', () => {
  const assets = ['2024-06-20T12:00:00', '2024-06-15T12:00:00', '2024-06-10T12:00:00'].map((localDateTime) =>
    assetFactory.build({ localDateTime, width: 1000, height: 1000 }),
  );
  const viewport = { width: 500, height: 500 };
  let assetInteraction: AssetMultiSelectManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('ResizeObserver', getResizeObserverMock());
    vi.stubGlobal('scrollTo', vi.fn());
    authManager.setPreferences(preferencesFactory.build());
    assetInteraction = new AssetMultiSelectManager();
    Object.assign(page, { url: new URL('http://localhost/search?at=2024-06-15'), params: {} });
  });

  afterEach(() => {
    assetInteraction.destroy();
    authManager.reset();
    vi.unstubAllGlobals();
  });

  it('scrolls to the requested day while preserving the search result order', async () => {
    renderWithTooltips(GalleryViewer, { assets, assetInteraction, viewport, slidingWindowOffset: 80 });
    const callback = vi.mocked(afterNavigate).mock.calls[0][0];
    callback({ complete: Promise.resolve() } as never);

    const geometry = getJustifiedLayoutFromAssets(assets, {
      spacing: 2,
      heightTolerance: 0.5,
      rowHeight: 100,
      rowWidth: viewport.width,
    });
    await waitFor(() => expect(globalThis.scrollTo).toHaveBeenCalledWith({ top: 80 + geometry.getTop(1) }));
  });

  it('does not move the gallery while a photo is open', async () => {
    Object.assign(page, { params: { assetId: assets[0].id } });
    renderWithTooltips(GalleryViewer, { assets, assetInteraction, viewport });
    vi.mocked(afterNavigate).mock.calls[0][0]({ complete: Promise.resolve() } as never);
    await Promise.resolve();

    expect(globalThis.scrollTo).not.toHaveBeenCalled();
  });
});
