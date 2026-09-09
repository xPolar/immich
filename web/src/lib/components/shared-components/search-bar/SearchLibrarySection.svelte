<script lang="ts">
  import Combobox from '$lib/components/shared-components/Combobox.svelte';
  import { getSearchLibraries, type SearchLibraryResponseDto } from '@immich/sdk';
  import { Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    libraryId?: string | null;
  }

  let { libraryId = $bindable() }: Props = $props();
  let libraries: SearchLibraryResponseDto[] = $state([]);
  let failed = $state(false);

  const options = $derived([
    { label: $t('all_libraries'), value: '' },
    { label: $t('search_library_uploads'), value: 'uploads' },
    ...libraries.map(({ id, name }) => ({ label: name, value: id })),
  ]);
  const selectedValue = $derived(libraryId === null ? 'uploads' : (libraryId ?? ''));
  const selectedOption = $derived(
    options.find(({ value }) => value === selectedValue) ?? { label: selectedValue, value: selectedValue },
  );

  onMount(async () => {
    try {
      libraries = await getSearchLibraries();
    } catch {
      failed = true;
    }
  });
</script>

<div>
  <Text fontWeight="medium">{$t('library')}</Text>
  <div class="mt-1">
    <Combobox
      label={$t('library')}
      hideLabel
      {options}
      {selectedOption}
      onSelect={(option) => (libraryId = option?.value === 'uploads' ? null : option?.value || undefined)}
    />
  </div>
  {#if failed}
    <p role="alert" class="mt-2 text-sm text-danger">{$t('errors.failed_to_load_libraries')}</p>
  {/if}
</div>
