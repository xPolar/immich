import { goto } from '$app/navigation';
import { page } from '$app/state';
import { currentUrlReplaceAssetId, navigate } from './navigation';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/search?query=beach&at=old-asset&atTime=2024-06-15T12:30:00.123'),
    route: { id: '/(user)/search/[[photos=photos]]/[[assetId=id]]' },
    data: {},
    params: {},
  },
}));

describe('gallery scroll targets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(page, {
      url: new URL('http://localhost/search?query=beach&at=old-asset&atTime=2024-06-15T12:30:00.123'),
    });
  });

  it('clears both position parameters when opening another photo', () => {
    expect(currentUrlReplaceAssetId('next-asset')).toBe('/search/photos/next-asset?query=beach');
  });

  it('does not reuse a previous timestamp when closing to a different asset', async () => {
    await navigate({ targetRoute: 'current', assetId: null, assetGridRouteSearchParams: { at: 'next-asset' } });

    expect(goto).toHaveBeenCalledWith('/search?query=beach&at=next-asset', undefined);
  });

  it('preserves timestamp precision and gallery filters', async () => {
    await navigate({
      targetRoute: 'current',
      assetId: null,
      assetGridRouteSearchParams: { at: 'next-asset', atTime: '2024-06-15T12:30:59.987' },
    });

    expect(goto).toHaveBeenCalledWith(
      '/search?query=beach&at=next-asset&atTime=2024-06-15T12%3A30%3A59.987',
      undefined,
    );
  });
});
