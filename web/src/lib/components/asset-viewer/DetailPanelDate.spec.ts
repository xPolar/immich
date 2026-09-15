import { modalManager } from '@immich/ui';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { authManager } from '$lib/managers/auth-manager.svelte';
import AssetChangeDateModal from '$lib/modals/AssetChangeDateModal.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import DetailPanelDate from './DetailPanelDate.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/photos/asset-id'), route: { id: '' }, data: {}, params: {} },
}));

describe('DetailPanelDate', () => {
  const asset = assetFactory.build({ id: 'asset-id', ownerId: 'owner-id', localDateTime: '2024-06-15T12:30:00' });

  beforeEach(() => {
    authManager.setUser(userAdminFactory.build({ id: asset.ownerId }));
    authManager.setPreferences(preferencesFactory.build());
    vi.spyOn(modalManager, 'show').mockImplementation(vi.fn());
  });

  afterEach(() => {
    authManager.reset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    ['/(user)/photos/[[assetId=id]]', '/photos/asset-id', '/photos?at=asset-id'],
    [
      '/(user)/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]',
      '/albums/album-id/photos/asset-id',
      '/albums/album-id?at=asset-id',
    ],
    [
      '/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]',
      '/people/person-id/photos/asset-id',
      '/people/person-id?at=asset-id',
    ],
    [
      '/(user)/search/[[photos=photos]]/[[assetId=id]]',
      '/search/photos/asset-id?query=beach&libraryId=library-id',
      '/search?query=beach&libraryId=library-id&at=asset-id',
    ],
    [
      '/(user)/share/[key]/[[photos=photos]]/[[assetId=id]]',
      '/share/shared-key/photos/asset-id',
      '/share/shared-key?at=asset-id',
    ],
  ])('keeps a normal click in %s', async (routeId, pathname, expected) => {
    Object.assign(page, { url: new URL(pathname, 'http://localhost'), route: { id: routeId } });
    render(DetailPanelDate, { asset });

    await fireEvent.click(screen.getByTestId('detail-panel-view-date-button'));

    expect(goto).toHaveBeenCalledWith(`${expected}&atTime=2024-06-15T12%3A30%3A00.000`, undefined);
    expect(modalManager.show).not.toHaveBeenCalled();
  });

  it('opens the home timeline on Shift-click without carrying gallery filters', async () => {
    Object.assign(page, { url: new URL('http://localhost/search/photos/asset-id?query=beach') });
    render(DetailPanelDate, { asset });

    await fireEvent.click(screen.getByTestId('detail-panel-view-date-button'), { shiftKey: true });

    expect(goto).toHaveBeenCalledWith('/photos?at=asset-id&atTime=2024-06-15T12%3A30%3A00.000');
    expect(modalManager.show).not.toHaveBeenCalled();
  });

  it('targets the primary asset in the home gallery and retains the displayed timestamp as a fallback', async () => {
    render(DetailPanelDate, {
      asset: { ...asset, stack: { id: 'stack-id', primaryAssetId: 'primary-id', assetCount: 2 } },
    });

    await fireEvent.click(screen.getByTestId('detail-panel-view-date-button'), { shiftKey: true });

    expect(goto).toHaveBeenCalledWith('/photos?at=primary-id&atTime=2024-06-15T12%3A30%3A00.000');
  });

  it('uses the displayed local date instead of the UTC day', async () => {
    render(DetailPanelDate, {
      asset: {
        ...asset,
        exifInfo: { dateTimeOriginal: '2024-06-16T02:30:00Z', timeZone: 'America/New_York' },
      },
    });

    await fireEvent.click(screen.getByTestId('detail-panel-view-date-button'), { shiftKey: true });

    expect(goto).toHaveBeenCalledWith('/photos?at=asset-id&atTime=2024-06-15T22%3A30%3A00.000');
  });

  it('keeps date editing on the separate pencil button', async () => {
    render(DetailPanelDate, { asset });

    await fireEvent.click(screen.getByRole('button', { name: 'edit_date' }));

    expect(modalManager.show).toHaveBeenCalledWith(
      AssetChangeDateModal,
      expect.objectContaining({ asset: expect.objectContaining({ id: asset.id }) }),
    );
    expect(goto).not.toHaveBeenCalled();
  });

  it('allows navigation but not editing for someone else’s asset', async () => {
    render(DetailPanelDate, { asset: { ...asset, ownerId: 'another-owner' } });

    expect(screen.queryByRole('button', { name: 'edit_date' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('detail-panel-view-date-button'), { shiftKey: true });
    expect(goto).toHaveBeenCalledWith('/photos?at=asset-id&atTime=2024-06-15T12%3A30%3A00.000');
  });
});
