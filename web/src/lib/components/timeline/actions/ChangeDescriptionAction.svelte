<script lang="ts">
  import {
    assetMultiSelectManager,
    type AssetMultiSelectManager,
  } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import AssetUpdateDescriptionConfirmModal from '$lib/modals/AssetUpdateDescriptionConfirmModal.svelte';
  import { getOwnedAssetsWithWarning } from '$lib/utils/asset-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { updateAssets } from '@immich/sdk';
  import { modalManager } from '@immich/ui';
  import { mdiText } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import MenuOption from '../../shared-components/context-menu/MenuOption.svelte';

  interface Props {
    menuItem?: boolean;
    assetInteraction?: AssetMultiSelectManager;
  }

  let { menuItem = false, assetInteraction = assetMultiSelectManager }: Props = $props();

  const handleUpdateDescription = async () => {
    const description = await modalManager.show(AssetUpdateDescriptionConfirmModal);
    if (description) {
      const ids = getOwnedAssetsWithWarning(assetInteraction.assets, authManager.user);

      try {
        await updateAssets({ assetBulkUpdateDto: { ids, description } });
        assetInteraction.clear();
      } catch (error) {
        handleError(error, $t('errors.unable_to_change_description'));
      }
    }
  };
</script>

{#if menuItem}
  <MenuOption text={$t('change_description')} icon={mdiText} onClick={() => handleUpdateDescription()} />
{/if}
