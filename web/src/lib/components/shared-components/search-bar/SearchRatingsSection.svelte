<script lang="ts">
  import { Text } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import Combobox from '../Combobox.svelte';

  interface Props {
    rating?: number | null;
    minimum?: boolean;
  }

  let { rating = $bindable(), minimum = false }: Props = $props();

  const options = $derived([
    { value: 'null', label: $t('rating_count', { values: { count: 0 } }) },
    ...[1, 2, 3, 4, 5].map((count) => ({
      value: count.toString(),
      label: `${$t('rating_count', { values: { count } })}${minimum ? '+' : ''}`,
    })),
  ]);
</script>

<div class="flex flex-col">
  <Text class="mb-2" fontWeight="medium">{$t('rating')}</Text>
  <Combobox
    label={$t('rating')}
    placeholder={$t('search_rating')}
    hideLabel
    {options}
    selectedOption={rating === undefined ? undefined : options[rating === null ? 0 : rating]}
    onSelect={(selected) =>
      (rating =
        selected === undefined ? undefined : selected.value === 'null' ? null : Number.parseInt(selected.value))}
  />
</div>
