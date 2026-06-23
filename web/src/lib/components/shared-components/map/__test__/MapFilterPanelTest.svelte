<script lang="ts">
  import { TooltipProvider } from '@immich/ui';
  import MapFilterPanel from '../MapFilterPanel.svelte';
  import { createMapFilterState, type MapFilterState } from '../map-filter';

  let filters = $state<MapFilterState>(createMapFilterState());
</script>

<TooltipProvider>
  <MapFilterPanel bind:filters />
</TooltipProvider>
