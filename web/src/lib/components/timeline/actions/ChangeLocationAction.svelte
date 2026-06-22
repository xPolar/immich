<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import {
    assetMultiSelectManager,
    type AssetMultiSelectManager,
  } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import GeolocationPointPickerModal from '$lib/modals/GeolocationPointPickerModal.svelte';
  import { getOwnedAssetsWithWarning } from '$lib/utils/asset-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { updateAssets } from '@immich/sdk';
  import { modalManager, toastManager } from '@immich/ui';
  import { mdiMapMarkerMultipleOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    menuItem?: boolean;
    assetInteraction?: AssetMultiSelectManager;
  };

  let { menuItem = false, assetInteraction = assetMultiSelectManager }: Props = $props();

  const onAction = async () => {
    const point = await modalManager.show(GeolocationPointPickerModal, {});
    if (!point) {
      return;
    }

    const ids = getOwnedAssetsWithWarning(assetInteraction.assets, authManager.user);

    try {
      await updateAssets({ assetBulkUpdateDto: { ids, latitude: point.lat, longitude: point.lng } });
      toastManager.primary();
      assetInteraction.clear();
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_location'));
    }
  };
</script>

{#if menuItem}
  <MenuOption text={$t('change_location')} icon={mdiMapMarkerMultipleOutline} onClick={onAction} />
{/if}
