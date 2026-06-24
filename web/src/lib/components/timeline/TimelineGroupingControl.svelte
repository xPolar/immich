<script lang="ts">
  import { t } from 'svelte-i18n';

  export type TimelineGroupingMode = 'years' | 'months' | 'all';

  interface Props {
    value: TimelineGroupingMode;
    onChange: (value: TimelineGroupingMode) => void;
  }

  let { value, onChange }: Props = $props();

  const options: Array<{ value: TimelineGroupingMode; label: 'years' | 'months' | 'all' }> = [
    { value: 'years', label: 'years' },
    { value: 'months', label: 'months' },
    { value: 'all', label: 'all' },
  ];
</script>

<div
  class="pointer-events-auto inline-flex rounded-full border border-gray-200 bg-immich-bg/95 p-1 shadow-md backdrop-blur-sm dark:border-gray-700 dark:bg-immich-dark-bg/95"
  role="group"
  aria-label={$t('timeline_grouping')}
>
  {#each options as option (option.value)}
    <button
      type="button"
      class={[
        'min-w-16 rounded-full px-3 py-1.5 text-sm font-medium transition-colors outline-none sm:min-w-20',
        value === option.value
          ? 'bg-immich-primary text-white dark:bg-immich-dark-primary dark:text-immich-dark-bg'
          : 'text-immich-fg hover:bg-gray-100 focus-visible:bg-gray-100 dark:text-immich-dark-fg dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800',
      ]}
      aria-pressed={value === option.value}
      onclick={() => onChange(option.value)}
    >
      {$t(option.label)}
    </button>
  {/each}
</div>
