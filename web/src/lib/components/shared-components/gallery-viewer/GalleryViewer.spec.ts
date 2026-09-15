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

  it.each(['exact asset', 'timestamp fallback'])('scrolls to the correct row using the %s', async (mode) => {
    const sameDayAssets = Array.from({ length: 15 }, (_, index) =>
      assetFactory.build({
        localDateTime: `2024-06-15T12:${String(index).padStart(2, '0')}:00.123`,
        width: 1000,
        height: 1000,
      }),
    );
    const target = sameDayAssets[10];
    const url = new URL('http://localhost/search');
    url.searchParams.set('at', mode === 'exact asset' ? target.id : 'missing-asset');
    url.searchParams.set('atTime', '2024-06-15T12:10:00.124');
    Object.assign(page, { url });
    renderWithTooltips(GalleryViewer, {
      assets: sameDayAssets,
      assetInteraction,
      viewport,
      slidingWindowOffset: 80,
    });

    vi.mocked(afterNavigate).mock.calls[0][0]({ complete: Promise.resolve() } as never);

    const geometry = getJustifiedLayoutFromAssets(sameDayAssets, {
      spacing: 2,
      heightTolerance: 0.5,
      rowHeight: 100,
      rowWidth: viewport.width,
    });
    expect(geometry.getTop(10)).toBeGreaterThan(0);
    await waitFor(() => expect(globalThis.scrollTo).toHaveBeenCalledWith({ top: 80 + geometry.getTop(10) }));
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-asset', target.id));
  });

  it('prefers the exact asset when several photos have identical timestamps', async () => {
    const sameTimeAssets = assetFactory.buildList(15, {
      localDateTime: '2024-06-15T12:30:00.123',
      width: 1000,
      height: 1000,
    });
    const url = new URL('http://localhost/search');
    url.searchParams.set('at', sameTimeAssets[10].id);
    url.searchParams.set('atTime', sameTimeAssets[10].localDateTime);
    Object.assign(page, { url });
    renderWithTooltips(GalleryViewer, { assets: sameTimeAssets, assetInteraction, viewport });

    vi.mocked(afterNavigate).mock.calls[0][0]({ complete: Promise.resolve() } as never);

    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-asset', sameTimeAssets[10].id));
  });

  it('ignores an invalid timestamp when the asset is absent', async () => {
    Object.assign(page, { url: new URL('http://localhost/search?at=missing&atTime=invalid') });
    renderWithTooltips(GalleryViewer, { assets, assetInteraction, viewport });
    vi.mocked(afterNavigate).mock.calls[0][0]({ complete: Promise.resolve() } as never);
    await Promise.resolve();

    expect(globalThis.scrollTo).not.toHaveBeenCalled();
  });
});
