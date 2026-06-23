<script lang="ts">
  import type { TypedSearchChoice } from '$lib/utils/typed-search/typed-search-resolver';
  import { Icon, LoadingSpinner, Text } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiTune } from '@mdi/js';

  interface Props {
    id: string;
    isOpen?: boolean;
    isLoading?: boolean;
    choices?: TypedSearchChoice[];
    message?: string;
    onSelect: (choice: TypedSearchChoice) => void;
    onActiveSelectionChange: (selectedId?: string) => void;
  }

  let {
    id,
    isOpen = false,
    isLoading = false,
    choices = [],
    message,
    onSelect,
    onActiveSelectionChange,
  }: Props = $props();

  let selectedIndex: number | undefined = $state();
  let element = $state<HTMLDivElement>();

  export function moveSelection(increment: 1 | -1) {
    if (choices.length === 0) {
      return;
    }
    if (selectedIndex === undefined) {
      selectedIndex = increment === 1 ? 0 : choices.length - 1;
    } else if (selectedIndex + increment < 0 || selectedIndex + increment >= choices.length) {
      clearSelection();
      return;
    } else {
      selectedIndex += increment;
    }
    onActiveSelectionChange(getId(selectedIndex));
  }

  export function clearSelection() {
    selectedIndex = undefined;
    onActiveSelectionChange();
  }

  export function selectActiveOption() {
    if (selectedIndex === undefined) {
      return;
    }
    const selectedElement = element?.querySelector(`#${getId(selectedIndex)}`) as HTMLElement;
    selectedElement?.click();
  }

  function getId(index: number) {
    return `${id}-${index}`;
  }

  function select(choice: TypedSearchChoice) {
    clearSelection();
    onSelect(choice);
  }
</script>

{#if isOpen}
  <div
    role="listbox"
    {id}
    bind:this={element}
    class="absolute z-1 w-full rounded-b-3xl border-2 border-t-0 border-gray-200 bg-white py-3 shadow-2xl dark:border-gray-700 dark:bg-immich-dark-gray dark:text-gray-300"
  >
    {#if isLoading}
      <div class="flex items-center justify-center py-3">
        <LoadingSpinner size="small" />
      </div>
    {:else if choices.length > 0}
      <Text class="px-5 py-2" color="muted">Search filters</Text>
      {#each choices as choice, index (`${choice.key}-${choice.id ?? choice.field}-${choice.label}`)}
        <button
          id={getId(index)}
          type="button"
          role="option"
          tabindex="-1"
          aria-selected={selectedIndex === index}
          class="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-gray-100 aria-selected:bg-gray-100 dark:hover:bg-gray-500/30 dark:aria-selected:bg-gray-500/30"
          onclick={() => select(choice)}
        >
          <Icon icon={mdiTune} size="1.4em" />
          <span class="font-medium">{choice.label}</span>
          {#if choice.field}
            <span class="text-xs text-gray-500 dark:text-gray-400">{choice.field}</span>
          {/if}
        </button>
      {/each}
    {:else if message}
      <div class="flex items-center gap-3 px-5 py-3 text-sm text-red-600 dark:text-red-400">
        <Icon icon={mdiAlertCircleOutline} size="1.4em" />
        <span>{message}</span>
      </div>
    {/if}
  </div>
{/if}
