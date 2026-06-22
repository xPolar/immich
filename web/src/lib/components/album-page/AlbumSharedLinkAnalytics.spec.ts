import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AlbumSharedLinkAnalytics from './AlbumSharedLinkAnalytics.svelte';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => (resolve = resolvePromise));
  return { promise, resolve };
};

describe('AlbumSharedLinkAnalytics', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    sdkMock.getAlbumSharedLinkViews.mockReset();
  });

  it('refetches on album navigation and ignores the stale response', async () => {
    const albumA = deferred<{ totalViews: number; uniqueBrowsers: number; daily: [] }>();
    const albumB = deferred<{ totalViews: number; uniqueBrowsers: number; daily: [] }>();
    sdkMock.getAlbumSharedLinkViews.mockImplementation(({ id }) =>
      id === 'album-a' ? albumA.promise : albumB.promise,
    );

    const { rerender } = render(AlbumSharedLinkAnalytics, { albumId: 'album-a' });
    await waitFor(() => expect(sdkMock.getAlbumSharedLinkViews).toHaveBeenCalledWith({ id: 'album-a', period: 'all' }));

    await rerender({ albumId: 'album-b' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await waitFor(() => expect(sdkMock.getAlbumSharedLinkViews).toHaveBeenCalledWith({ id: 'album-b', period: 'all' }));

    albumB.resolve({ totalViews: 20, uniqueBrowsers: 8, daily: [] });
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('20 views · 8 unique browsers'));

    albumA.resolve({ totalViews: 10, uniqueBrowsers: 4, daily: [] });
    await albumA.promise;
    await tick();

    expect(screen.getByRole('button')).toHaveTextContent('20 views · 8 unique browsers');
  });
});
