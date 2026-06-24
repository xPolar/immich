<script lang="ts">
  import type { SearchDisplayFilters } from '$lib/types';
  import { Checkbox, Label, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    filters: SearchDisplayFilters;
  };

  let { filters = $bindable() }: Props = $props();
</script>

<div id="display-options-selection">
  <fieldset>
    <Text class="mb-2" fontWeight="medium">{$t('display_options')}</Text>

    <div class="mt-1 flex flex-wrap gap-x-5 gap-y-2">
      <div class="flex items-center gap-2">
        <Checkbox id="not-in-album-checkbox" size="tiny" bind:checked={filters.isNotInAlbum} />
        <Label label={$t('not_in_any_album')} for="not-in-album-checkbox" class="text-sm font-normal" />
      </div>
      <div class="flex items-center gap-2">
        <Checkbox id="archive-checkbox" size="tiny" bind:checked={filters.isArchive} />
        <Label label={$t('archive')} for="archive-checkbox" class="text-sm font-normal" />
      </div>
      <div class="flex items-center gap-2">
        <Checkbox id="stacked-checkbox" size="tiny" bind:checked={filters.isStacked} />
        <Label label={$t('stacked')} for="stacked-checkbox" class="text-sm font-normal" />
      </div>
    </div>
  </fieldset>

  <fieldset class="mt-4">
    <Text class="mb-2" fontWeight="medium">{$t('favorite')}</Text>
    <div class="flex flex-wrap gap-x-5 gap-y-2">
      <label class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="favorite-filter"
          checked={filters.isFavorite === undefined}
          onchange={() => (filters.isFavorite = undefined)}
        />
        {$t('all')}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="favorite-filter"
          checked={filters.isFavorite === true}
          onchange={() => (filters.isFavorite = true)}
        />
        {$t('favorites')}
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="favorite-filter"
          checked={filters.isFavorite === false}
          onchange={() => (filters.isFavorite = false)}
        />
        {$t('search_filter_not_favorites')}
      </label>
    </div>
  </fieldset>
</div>
