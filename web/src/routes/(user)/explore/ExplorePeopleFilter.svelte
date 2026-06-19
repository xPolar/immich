<script lang="ts">
  import { Button, NumberInput } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    minimumDays: number;
    isLoading?: boolean;
    onApply: (minimumDays: number) => void;
  }

  let { minimumDays, isLoading = false, onApply }: Props = $props();
  let value = $state(minimumDays);
  let isValid = $derived(value !== undefined && Number.isInteger(value) && value >= 1);

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (isValid && value !== undefined) {
      onApply(value);
    }
  };
</script>

<form class="flex items-center gap-2" onsubmit={handleSubmit}>
  <label for="explore-people-minimum-days" class="text-sm dark:text-immich-dark-fg">{$t('minimum_days')}</label>
  <NumberInput
    id="explore-people-minimum-days"
    class="w-20"
    inputSize={3}
    min={1}
    step={1}
    bind:value
    disabled={isLoading}
  />
  <Button type="submit" size="small" variant="outline" disabled={!isValid || isLoading}>
    {$t('search_filter_apply')}
  </Button>
</form>
