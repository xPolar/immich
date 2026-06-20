<script lang="ts">
  import { goto } from '$app/navigation';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import RightClickContextMenu from '$lib/components/shared-components/context-menu/RightClickContextMenu.svelte';
  import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDateAction from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescriptionAction from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocationAction from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import DeleteAssetsAction from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import RemoveFromAlbumAction from '$lib/components/timeline/actions/RemoveFromAlbumAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import StackAction from '$lib/components/timeline/actions/StackAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
  import ProfileImageCropperModal from '$lib/modals/ProfileImageCropperModal.svelte';
  import SharedLinkCreateModal from '$lib/modals/SharedLinkCreateModal.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { getSharedLink } from '$lib/utils';
  import type {
    OnArchive,
    OnDelete,
    OnFavorite,
    OnRestore,
    OnSetVisibility,
    OnStack,
    OnUndoDelete,
    OnUnstack,
  } from '$lib/utils/actions';
  import type { ContextMenuPosition } from '$lib/utils/context-menu';
  import { handleError } from '$lib/utils/handle-error';
  import { AssetVisibility, getAssetInfo, restoreAssets, updateAlbumInfo, type AlbumResponseDto } from '@immich/sdk';
  import { modalManager, toastManager } from '@immich/ui';
  import {
    mdiAccountCircleOutline,
    mdiCompare,
    mdiEyeOutline,
    mdiHistory,
    mdiImageOutline,
    mdiShareVariantOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    asset?: TimelineAsset;
    album?: AlbumResponseDto;
    position: ContextMenuPosition;
    isOpen: boolean;
    allowDeletion?: boolean;
    onClose: () => void;
    onView: (asset: TimelineAsset) => void;
    onArchive?: OnArchive;
    onDelete?: OnDelete;
    onFavorite?: OnFavorite;
    onRestore?: OnRestore;
    onSetVisibility?: OnSetVisibility;
    onStack?: OnStack;
    onUndoDelete?: OnUndoDelete;
    onUnstack?: OnUnstack;
    onRemoveFromAlbum?: (assetIds: string[]) => void;
  }

  let {
    asset,
    album,
    position,
    isOpen,
    allowDeletion = true,
    onClose,
    onView,
    onArchive,
    onDelete,
    onFavorite,
    onRestore,
    onSetVisibility,
    onStack,
    onUndoDelete,
    onUnstack,
    onRemoveFromAlbum,
  }: Props = $props();

  const sharedLink = getSharedLink();
  const selectedAssets = $derived(assetMultiSelectManager.assets);
  const allTrashed = $derived(selectedAssets.length > 0 && selectedAssets.every(({ isTrashed }) => isTrashed));
  const allLocked = $derived(
    selectedAssets.length > 0 && selectedAssets.every(({ visibility }) => visibility === AssetVisibility.Locked),
  );
  const canManage = $derived(assetMultiSelectManager.isAllUserOwned);
  const canOrganize = $derived(canManage && !allTrashed && !allLocked);
  const canDownload = $derived(!sharedLink || sharedLink.allowDownload);
  const canRemoveFromAlbum = $derived(
    album &&
      authManager.authenticated &&
      (canManage || album.albumUsers[0]?.user.id === authManager.user.id) &&
      !!onRemoveFromAlbum,
  );
  const Actions = $derived(getAssetBulkActions($t));

  const handleShare = () => modalManager.show(SharedLinkCreateModal, { assetIds: selectedAssets.map(({ id }) => id) });

  const handleRestore = async () => {
    const ids = selectedAssets.map(({ id }) => id);
    try {
      await restoreAssets({ bulkIdsDto: { ids } });
      onRestore?.(ids);
      toastManager.primary($t('assets_restored_count', { values: { count: ids.length } }));
      assetMultiSelectManager.clear();
    } catch (error) {
      handleError(error, $t('errors.unable_to_restore_assets'));
    }
  };

  const handleSetAlbumCover = async () => {
    if (!asset || !album) {
      return;
    }

    const selectedAsset = asset;
    assetMultiSelectManager.clear();

    try {
      const response = await updateAlbumInfo({
        id: album.id,
        updateAlbumDto: { albumThumbnailAssetId: selectedAsset.id },
      });
      eventManager.emit('AlbumUpdate', response);
      toastManager.primary($t('album_cover_updated'));
    } catch (error) {
      handleError(error, $t('errors.unable_to_update_album_cover'));
    }
  };

  const handleSetProfilePicture = async () => {
    if (!asset) {
      return;
    }

    const selectedAsset = asset;
    assetMultiSelectManager.clear();

    try {
      const fullAsset = await getAssetInfo({ ...authManager.params, id: selectedAsset.id });
      await modalManager.show(ProfileImageCropperModal, { asset: fullAsset });
    } catch (error) {
      handleError(error, $t('errors.unable_to_set_profile_picture'));
    }
  };

  const handleViewSimilar = async () => {
    if (!asset) {
      return;
    }

    assetMultiSelectManager.clear();
    await goto(Route.search({ queryAssetId: asset.stack?.primaryAssetId ?? asset.id }));
  };
</script>

<RightClickContextMenu title={$t('assets')} x={position.x} y={position.y} {isOpen} {onClose}>
  {#if asset}
    <MenuOption icon={mdiEyeOutline} text={$t('open')} onClick={() => onView(asset)} />

    {#if canDownload}
      <DownloadAction menuItem />
    {/if}

    {#if !sharedLink && canOrganize}
      <MenuOption icon={mdiShareVariantOutline} text={$t('share')} onClick={handleShare} />
      <FavoriteAction menuItem removeFavorite={assetMultiSelectManager.isAllFavorite} {onFavorite} />
      <ActionMenuItem action={Actions.AddToAlbum} />
    {/if}

    {#if !sharedLink && !allTrashed && !allLocked && !assetMultiSelectManager.isAllArchived && selectedAssets.length === 1 && featureFlagsManager.value.smartSearch}
      <MenuOption icon={mdiCompare} text={$t('view_similar_photos')} onClick={handleViewSimilar} />
    {/if}

    {#if !sharedLink && album && selectedAssets.length === 1}
      <MenuOption icon={mdiImageOutline} text={$t('set_as_album_cover')} onClick={handleSetAlbumCover} />
    {/if}

    {#if !sharedLink && canRemoveFromAlbum && album}
      <RemoveFromAlbumAction {album} onRemove={onRemoveFromAlbum} menuItem />
    {/if}

    {#if !sharedLink && canManage}
      <hr />

      {#if canOrganize && onStack && onUnstack && (selectedAssets.length > 1 || selectedAssets[0]?.stack)}
        <StackAction unstack={selectedAssets.length === 1 && !!selectedAssets[0].stack} {onStack} {onUnstack} />
      {/if}

      {#if !allTrashed}
        <ChangeDateAction menuItem />
        <ChangeDescriptionAction menuItem />
        <ChangeLocationAction menuItem />
      {/if}

      {#if canOrganize && authManager.preferences.tags.enabled}
        <TagAction menuItem />
      {/if}

      {#if canOrganize && selectedAssets.length === 1 && asset.isImage}
        <MenuOption
          icon={mdiAccountCircleOutline}
          text={$t('set_as_profile_picture')}
          onClick={handleSetProfilePicture}
        />
      {/if}

      {#if allTrashed}
        <MenuOption icon={mdiHistory} text={$t('restore')} onClick={handleRestore} />
      {:else}
        {#if !allLocked && onArchive}
          <ArchiveAction menuItem unarchive={assetMultiSelectManager.isAllArchived} {onArchive} />
        {/if}
        {#if onSetVisibility}
          <SetVisibilityAction menuItem unlock={allLocked} onVisibilitySet={onSetVisibility} />
        {/if}
      {/if}

      {#if allowDeletion && onDelete}
        <hr />
        <DeleteAssetsAction menuItem force={allTrashed || allLocked} onAssetDelete={onDelete} {onUndoDelete} />
      {/if}
    {/if}
  {/if}
</RightClickContextMenu>
