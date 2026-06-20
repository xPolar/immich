import { fireEvent, render } from '@testing-library/svelte';
import AssetContextMenu from '$lib/components/assets/AssetContextMenu.svelte';
import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { toTimelineAsset } from '$lib/utils/timeline-util';
import { assetFactory } from '@test-data/factories/asset-factory';

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { smartSearch: false } },
}));

describe('AssetContextMenu', () => {
  afterEach(() => {
    assetMultiSelectManager.clear();
  });

  it('opens the selected asset from the menu', async () => {
    const asset = toTimelineAsset(assetFactory.build());
    const onView = vi.fn();
    assetMultiSelectManager.selectAsset(asset);

    const sut = render(AssetContextMenu, {
      asset,
      position: { x: 100, y: 100 },
      isOpen: true,
      onClose: vi.fn(),
      onView,
    });

    expect(sut.getByRole('menu', { name: 'assets' })).toBeInTheDocument();
    await fireEvent.click(sut.getByRole('menuitem', { name: 'open' }));

    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: asset.id }));
  });
});
