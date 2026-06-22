<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import {
    assetMultiSelectManager,
    type AssetMultiSelectManager,
  } from '$lib/managers/asset-multi-select-manager.svelte';
  import AssetSelectionChangeDateModal from '$lib/modals/AssetSelectionChangeDateModal.svelte';
  import { fromTimelinePlainDateTime } from '$lib/utils/timeline-util';
  import { modalManager } from '@immich/ui';
  import { mdiCalendarEditOutline } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    menuItem?: boolean;
    assetInteraction?: AssetMultiSelectManager;
  };

  let { menuItem = false, assetInteraction = assetMultiSelectManager }: Props = $props();

  const handleChangeDate = async () => {
    const assets = assetInteraction.ownedAssets;
    const initialDate = assets.length === 1 ? fromTimelinePlainDateTime(assets[0].localDateTime) : DateTime.now();
    const success = await modalManager.show(AssetSelectionChangeDateModal, {
      initialDate,
      assets,
    });
    if (success) {
      assetInteraction.clear();
    }
  };
</script>

{#if menuItem}
  <MenuOption text={$t('change_date')} icon={mdiCalendarEditOutline} onClick={handleChangeDate} />
{/if}
