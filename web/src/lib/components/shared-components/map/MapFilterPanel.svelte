<script lang="ts">
  import SearchCameraSection from '$lib/components/shared-components/search-bar/SearchCameraSection.svelte';
  import SearchDateSection from '$lib/components/shared-components/search-bar/SearchDateSection.svelte';
  import SearchMediaSection from '$lib/components/shared-components/search-bar/SearchMediaSection.svelte';
  import SearchPeopleSection from '$lib/components/shared-components/search-bar/SearchPeopleSection.svelte';
  import SearchRatingsSection from '$lib/components/shared-components/search-bar/SearchRatingsSection.svelte';
  import SearchTagsSection from '$lib/components/shared-components/search-bar/SearchTagsSection.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { Button, CloseButton, Field, Switch } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { createMapFilterState, getActiveMapFilterCount, type MapFilterState } from './map-filter';

  interface Props {
    filters: MapFilterState;
    onClose?: () => void;
  }

  let { filters = $bindable(), onClose }: Props = $props();
  let activeFilterCount = $derived(getActiveMapFilterCount(filters));
</script>

<aside
  class="flex size-full w-80 shrink-0 flex-col border-e border-gray-200 bg-immich-bg dark:border-immich-dark-gray dark:bg-immich-dark-bg"
>
  <div class="flex min-h-12 items-center justify-between border-b border-gray-200 px-4 dark:border-immich-dark-gray">
    <div class="flex items-center gap-2">
      <h2 class="font-medium">{$t('filters')}</h2>
      {#if activeFilterCount > 0}
        <span class="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-white">{activeFilterCount}</span>
      {/if}
    </div>
    {#if onClose}
      <CloseButton onclick={onClose} />
    {/if}
  </div>

  <div class="flex min-h-0 flex-1 immich-scrollbar flex-col gap-6 overflow-y-auto p-4">
    <SearchPeopleSection bind:selectedPeople={filters.personIds} />
    <SearchCameraSection bind:filters={filters.camera} />
    <SearchTagsSection bind:selectedTags={filters.tagIds} showUntagged={false} />
    <SearchDateSection bind:filters={filters.date} />

    {#if authManager.authenticated && authManager.preferences.ratings.enabled}
      <SearchRatingsSection bind:rating={filters.rating} minimum />
    {/if}

    <SearchMediaSection bind:filteredMedia={filters.mediaType} />

    <Field label={$t('only_favorites')}>
      <Switch bind:checked={filters.isFavorite} />
    </Field>
  </div>

  <div class="border-t border-gray-200 p-3 dark:border-immich-dark-gray">
    <Button
      shape="round"
      size="small"
      color="secondary"
      variant="ghost"
      fullWidth
      disabled={activeFilterCount === 0}
      onclick={() => (filters = createMapFilterState())}
    >
      {$t('clear_all')}
    </Button>
  </div>
</aside>
