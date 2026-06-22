import { modalManager } from '@immich/ui';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import ChangeDescriptionAction from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
import ChangeLocationAction from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
import { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { toTimelineAsset } from '$lib/utils/timeline-util';
import { assetFactory } from '@test-data/factories/asset-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';

describe('context-menu asset actions', () => {
  const user = userAdminFactory.build();

  beforeEach(() => {
    authManager.setUser(user);
  });

  afterEach(() => {
    authManager.reset();
    vi.restoreAllMocks();
  });

  it('retains the target while the description modal is open', async () => {
    const assetInteraction = new AssetMultiSelectManager();
    const asset = toTimelineAsset(assetFactory.build({ ownerId: user.id }));
    assetInteraction.selectAsset(asset);
    let resolveModal!: (description: string) => void;
    const modalResult = new Promise<string>((resolve) => (resolveModal = resolve));
    vi.spyOn(modalManager, 'show').mockImplementation(() => modalResult as never);

    const sut = render(ChangeDescriptionAction, { menuItem: true, assetInteraction });
    await fireEvent.click(sut.getByRole('menuitem', { name: 'change_description' }));
    assetInteraction.clear();
    resolveModal('updated description');

    await waitFor(() =>
      expect(sdkMock.updateAssets).toHaveBeenCalledWith({
        assetBulkUpdateDto: { ids: [asset.id], description: 'updated description' },
      }),
    );
  });

  it('retains the target while the location modal is open', async () => {
    const assetInteraction = new AssetMultiSelectManager();
    const asset = toTimelineAsset(assetFactory.build({ ownerId: user.id }));
    assetInteraction.selectAsset(asset);
    let resolveModal!: (point: { lat: number; lng: number }) => void;
    const modalResult = new Promise<{ lat: number; lng: number }>((resolve) => (resolveModal = resolve));
    vi.spyOn(modalManager, 'show').mockImplementation(() => modalResult as never);

    const sut = render(ChangeLocationAction, { menuItem: true, assetInteraction });
    await fireEvent.click(sut.getByRole('menuitem', { name: 'change_location' }));
    assetInteraction.clear();
    resolveModal({ lat: 12, lng: 34 });

    await waitFor(() =>
      expect(sdkMock.updateAssets).toHaveBeenCalledWith({
        assetBulkUpdateDto: { ids: [asset.id], latitude: 12, longitude: 34 },
      }),
    );
  });
});
