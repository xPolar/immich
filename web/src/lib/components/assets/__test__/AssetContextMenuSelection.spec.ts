import { modalManager } from '@immich/ui';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import AssetContextMenu from '$lib/components/assets/AssetContextMenu.svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { toTimelineAsset } from '$lib/utils/timeline-util';
import { assetFactory } from '@test-data/factories/asset-factory';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { smartSearch: true } },
}));

describe('AssetContextMenu selection', () => {
  const user = userAdminFactory.build();

  beforeEach(() => {
    authManager.setUser(user);
    authManager.setPreferences(preferencesFactory.build());
  });

  afterEach(() => {
    assetMultiSelectManager.clear();
    authManager.reset();
    vi.restoreAllMocks();
  });

  it('favorites all selected assets when the target is selected', async () => {
    const assets = assetFactory
      .buildList(3, { ownerId: user.id, isFavorite: false })
      .map((asset) => toTimelineAsset(asset));
    assetMultiSelectManager.selectAssets(assets);
    const onFavorite = vi.fn();
    const sut = render(AssetContextMenu, {
      asset: assets[1],
      position: { x: 100, y: 100 },
      isOpen: true,
      onClose: vi.fn(),
      onView: vi.fn(),
      onFavorite,
    });

    expect(sut.queryByRole('menuitem', { name: 'view_similar_photos' })).not.toBeInTheDocument();
    expect(sut.queryByRole('menuitem', { name: 'set_as_profile_picture' })).not.toBeInTheDocument();
    await fireEvent.click(sut.getByRole('menuitem', { name: 'to_favorite' }));

    await waitFor(() =>
      expect(sdkMock.updateAssets).toHaveBeenCalledWith({
        assetBulkUpdateDto: { ids: assets.map(({ id }) => id), isFavorite: true },
      }),
    );
    expect(onFavorite).toHaveBeenCalledWith(
      assets.map(({ id }) => id),
      true,
    );
  });

  it('only favorites an unselected target without changing the selection', async () => {
    const assets = assetFactory
      .buildList(3, { ownerId: user.id, isFavorite: false })
      .map((asset) => toTimelineAsset(asset));
    assetMultiSelectManager.selectAssets(assets.slice(0, 2));
    const sut = render(AssetContextMenu, {
      asset: assets[2],
      position: { x: 100, y: 100 },
      isOpen: true,
      onClose: vi.fn(),
      onView: vi.fn(),
    });

    await fireEvent.click(sut.getByRole('menuitem', { name: 'to_favorite' }));

    await waitFor(() =>
      expect(sdkMock.updateAssets).toHaveBeenCalledWith({
        assetBulkUpdateDto: { ids: [assets[2].id], isFavorite: true },
      }),
    );
    expect(assetMultiSelectManager.assets).toEqual(assets.slice(0, 2));
  });

  it('preserves the selection when the menu is dismissed', async () => {
    const assets = assetFactory.buildList(2, { ownerId: user.id }).map((asset) => toTimelineAsset(asset));
    assetMultiSelectManager.selectAssets(assets);
    const sut = render(AssetContextMenu, {
      asset: assets[0],
      position: { x: 100, y: 100 },
      isOpen: true,
      onClose: vi.fn(),
      onView: vi.fn(),
    });

    await sut.rerender({ isOpen: false });

    expect(assetMultiSelectManager.assets).toEqual(assets);
  });

  it('retains all targets while a modal is open after the menu closes', async () => {
    const assets = assetFactory.buildList(2, { ownerId: user.id }).map((asset) => toTimelineAsset(asset));
    assetMultiSelectManager.selectAssets(assets);
    let resolveModal!: (description: string) => void;
    const modalResult = new Promise<string>((resolve) => (resolveModal = resolve));
    vi.spyOn(modalManager, 'show').mockImplementation(() => modalResult as never);
    const sut = render(AssetContextMenu, {
      asset: assets[0],
      position: { x: 100, y: 100 },
      isOpen: true,
      onClose: vi.fn(),
      onView: vi.fn(),
    });

    await fireEvent.click(sut.getByRole('menuitem', { name: 'change_description' }));
    await sut.rerender({ isOpen: false });
    assetMultiSelectManager.clear();
    resolveModal('updated description');

    await waitFor(() =>
      expect(sdkMock.updateAssets).toHaveBeenCalledWith({
        assetBulkUpdateDto: { ids: assets.map(({ id }) => id), description: 'updated description' },
      }),
    );
  });
});
