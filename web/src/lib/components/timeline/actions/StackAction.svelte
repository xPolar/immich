<script lang="ts">
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import {
    assetMultiSelectManager,
    type AssetMultiSelectManager,
  } from '$lib/managers/asset-multi-select-manager.svelte';
  import type { OnStack, OnUnstack } from '$lib/utils/actions';
  import { deleteStack, stackAssets } from '$lib/utils/asset-utils';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { mdiImageMultipleOutline, mdiImageOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    unstack?: boolean;
    onStack: OnStack | undefined;
    onUnstack: OnUnstack | undefined;
    assetInteraction?: AssetMultiSelectManager;
  }

  let { unstack = false, onStack, onUnstack, assetInteraction = assetMultiSelectManager }: Props = $props();

  const handleStack = async () => {
    const result = await stackAssets(assetInteraction.ownedAssets);
    onStack?.(result);
    assetInteraction.clear();
  };

  const handleUnstack = async () => {
    const selectedAssets = assetInteraction.ownedAssets;
    if (selectedAssets.length !== 1) {
      return;
    }
    const { stack } = selectedAssets[0];
    if (!stack) {
      return;
    }
    const unstackedAssets = await deleteStack([stack.id]);
    if (unstackedAssets) {
      onUnstack?.(unstackedAssets.map((a) => toTimelineAsset(a)));
    }
    assetInteraction.clear();
  };
</script>

{#if unstack}
  <MenuOption text={$t('unstack')} icon={mdiImageOffOutline} onClick={handleUnstack} />
{:else}
  <MenuOption text={$t('stack')} icon={mdiImageMultipleOutline} onClick={handleStack} />
{/if}
