<script lang="ts">
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import type {
    LiveTypedSearchChoice,
    LiveTypedSearchKey,
    LiveTypedSearchStatus,
  } from '$lib/utils/typed-search/typed-search-live-suggestions';
  import type { TypedSearchDisplayToken, TypedSearchIssue } from '$lib/utils/typed-search/typed-search-parser';
  import type { TypedSearchChoice } from '$lib/utils/typed-search/typed-search-resolver';
  import { Icon } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiTune } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import TypedSearchTokenRail from './TypedSearchTokenRail.svelte';

  type SelectableChoice =
    | { kind: 'live'; choice: LiveTypedSearchChoice }
    | { kind: 'commit'; choice: TypedSearchChoice };

  interface Props {
    id: string;
    isOpen?: boolean;
    status?: LiveTypedSearchStatus;
    tokens?: TypedSearchDisplayToken[];
    issues?: TypedSearchIssue[];
    choices?: TypedSearchChoice[];
    onSelectLive: (choice: LiveTypedSearchChoice) => void;
    onSelectChoice: (choice: TypedSearchChoice) => void;
    onActiveSelectionChange: (selectedId?: string) => void;
  }

  let {
    id,
    isOpen = false,
    status = { status: 'idle' },
    tokens = [],
    issues = [],
    choices = [],
    onSelectLive,
    onSelectChoice,
    onActiveSelectionChange,
  }: Props = $props();

  let selectedIndex: number | undefined = $state();
  let previousLiveSignature = '';

  const selectableChoices = $derived<SelectableChoice[]>([
    ...choices.map((choice) => ({ kind: 'commit' as const, choice })),
    ...(status.status === 'ok' ? status.items.map((choice) => ({ kind: 'live' as const, choice })) : []),
  ]);

  $effect(() => {
    const signature =
      status.status === 'ok' ? `${status.key}:${status.items.map((choice) => choice.id).join('|')}` : status.status;
    if (signature === previousLiveSignature) {
      return;
    }
    previousLiveSignature = signature;
    selectedIndex = status.status === 'ok' && status.items.length > 0 && choices.length === 0 ? 0 : undefined;
    onActiveSelectionChange(selectedIndex === undefined ? undefined : getId(selectedIndex));
  });

  export function moveSelection(increment: 1 | -1) {
    if (selectableChoices.length === 0) {
      return;
    }
    if (selectedIndex === undefined) {
      selectedIndex = increment === 1 ? 0 : selectableChoices.length - 1;
    } else if (selectedIndex + increment < 0 || selectedIndex + increment >= selectableChoices.length) {
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
      return false;
    }
    const item = selectableChoices[selectedIndex];
    if (!item) {
      return false;
    }
    select(item);
    return true;
  }

  function getId(index: number) {
    return `${id}-${index}`;
  }

  function select(item: SelectableChoice) {
    clearSelection();
    if (item.kind === 'live') {
      onSelectLive(item.choice);
    } else {
      onSelectChoice(item.choice);
    }
  }

  function pluralEntity(key: LiveTypedSearchKey) {
    switch (key) {
      case 'person': {
        return 'people';
      }
      case 'country': {
        return 'countries';
      }
      case 'city': {
        return 'cities';
      }
      case 'tag': {
        return 'tags';
      }
    }
  }

  function getLiveChoice(index: number) {
    const item = selectableChoices[index];
    return item?.kind === 'live' ? item.choice : undefined;
  }
</script>

{#if isOpen}
  <div
    role="listbox"
    {id}
    class="absolute z-1 max-h-[min(520px,calc(100vh-8rem))] w-full overflow-y-auto rounded-b-3xl border-2 border-t-0 border-gray-200 bg-white pb-3 shadow-2xl dark:border-gray-700 dark:bg-immich-dark-gray dark:text-gray-300"
  >
    <TypedSearchTokenRail {tokens} />

    {#if issues.length > 0}
      <section class="mb-3 pt-2" data-typed-search-issues>
        <p class="px-4 pb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400">
          {$t('search_filter_fix')}
        </p>
        <div class="space-y-1 px-3">
          {#each issues as issue (`${issue.raw}:${issue.code}`)}
            <div
              class="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200"
            >
              <Icon icon={mdiAlertCircleOutline} size="1.3em" />
              <span>{issue.message}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if choices.length > 0}
      <section class="mb-3 pt-2" data-typed-search-choices>
        <p class="px-4 pb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400">
          {$t('search_filter_choose_match')}
        </p>
        {#each choices as choice, index (`${choice.tokenRaw}:${choice.key}:${choice.id ?? choice.field ?? choice.label}`)}
          <button
            id={getId(index)}
            type="button"
            role="option"
            tabindex="-1"
            aria-selected={selectedIndex === index}
            aria-label={choice.label}
            class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-primary/10 aria-selected:bg-primary/10"
            onclick={() => select({ kind: 'commit', choice })}
          >
            <Icon icon={mdiTune} size="1.4em" />
            <span class="min-w-0 flex-1 truncate">{choice.label}</span>
            {#if choice.field}
              <span class="text-xs text-gray-500 dark:text-gray-400">{choice.field}</span>
            {/if}
          </button>
        {/each}
      </section>
    {/if}

    {#if status.status !== 'idle'}
      <section class="pt-2" data-live-typed-filter-section>
        <p class="px-4 pb-1 text-[11px] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400">
          {$t('search_filter_matches', { values: { filter: status.key } })}
        </p>
        {#if status.status === 'ok'}
          {#each status.items as choice, liveIndex (choice.id)}
            {@const index = choices.length + liveIndex}
            {@const liveChoice = getLiveChoice(index)}
            <button
              id={getId(index)}
              type="button"
              role="option"
              tabindex="-1"
              aria-selected={selectedIndex === index}
              aria-label={choice.label}
              class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-primary/10 aria-selected:bg-primary/10"
              onclick={() => liveChoice && select({ kind: 'live', choice: liveChoice })}
            >
              {#if choice.preview?.kind === 'person'}
                <img
                  src={getPeopleThumbnailUrl(choice.preview.data)}
                  alt=""
                  class="size-8 shrink-0 rounded-full object-cover"
                  loading="lazy"
                />
              {:else}
                <Icon icon={mdiTune} size="1.4em" />
              {/if}
              <span class="min-w-0 flex-1 truncate">
                <span>{choice.label}</span>
                {#if choice.secondaryLabel}
                  <span class="ms-2 text-xs text-gray-500 dark:text-gray-400">{choice.secondaryLabel}</span>
                {/if}
              </span>
              <span class="shrink-0 text-xs font-medium text-primary">{$t('search_filter_use_as_filter')}</span>
            </button>
          {/each}
        {:else if status.status === 'loading'}
          <p class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
            {$t('search_filter_loading_matches', { values: { filter: status.key } })}
          </p>
        {:else if status.status === 'empty'}
          <p class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
            {$t('search_filter_matches_none', { values: { filter: pluralEntity(status.key) } })}
          </p>
        {:else if status.status === 'timeout'}
          <p class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
            {$t('search_filter_matches_timeout', { values: { filter: status.key } })}
          </p>
        {:else}
          <p class="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
            {$t('search_filter_matches_error', { values: { filter: status.key } })}
          </p>
        {/if}
      </section>
    {/if}
  </div>
{/if}
