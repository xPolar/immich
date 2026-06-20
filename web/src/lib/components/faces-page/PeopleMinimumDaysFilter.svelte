<script lang="ts">
  import { Button, NumberInput } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    id?: string;
    minimumDays: number;
    isLoading?: boolean;
    onApply: (minimumDays: number) => void;
  }

  let { id = 'people-minimum-days', minimumDays, isLoading = false, onApply }: Props = $props();
  let value = $derived(minimumDays);
  let isValid = $derived(value !== undefined && Number.isInteger(value) && value >= 1);

  const handleSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (isValid && !isLoading && value !== undefined) {
      onApply(value);
    }
  };
</script>

<form class="flex items-center gap-2" onsubmit={handleSubmit}>
  <label for={id} class="text-sm whitespace-nowrap dark:text-immich-dark-fg">
    {$t('minimum_days')}
  </label>
  <NumberInput {id} class="w-20" inputSize={3} min={1} step={1} bind:value disabled={isLoading} />
  <Button class="whitespace-nowrap" type="submit" size="small" variant="outline" disabled={!isValid || isLoading}>
    {$t('apply')}
  </Button>
</form>
