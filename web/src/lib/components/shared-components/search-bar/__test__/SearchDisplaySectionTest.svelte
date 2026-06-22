<script lang="ts">
  import SearchDisplaySection from '$lib/components/shared-components/search-bar/SearchDisplaySection.svelte';
  import type { SearchDisplayFilters } from '$lib/types';

  let filters: SearchDisplayFilters = $state({
    isNotInAlbum: false,
    isArchive: false,
    isFavorite: false,
    isStacked: false,
  });
</script>

<SearchDisplaySection bind:filters />
