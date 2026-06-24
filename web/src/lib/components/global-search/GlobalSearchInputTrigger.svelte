<script lang="ts">
  import { globalSearchManager as manager } from '$lib/managers/global-search-manager.svelte';
  import { clickOutside } from '$lib/actions/click-outside';
  import { Icon } from '@immich/ui';
  import { mdiClose, mdiMagnify } from '@mdi/js';
  import { tick } from 'svelte';
  import { t } from 'svelte-i18n';

  let input = $state<HTMLInputElement>();
  let resultList = $state<HTMLDivElement>();
  let showProgress = $state(false);
  const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const open = () => {
    if (!manager.isOpen || manager.presentation !== 'dropdown') {
      manager.open('dropdown', input);
    }
  };

  $effect(() => {
    if (!manager.loading) {
      showProgress = false;
      return;
    }
    const timer = setTimeout(() => (showProgress = true), 200);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    const activeIndex = manager.activeIndex;
    void tick().then(() => {
      if (activeIndex >= 0) {
        resultList?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  function syncCaret(event: Event) {
    manager.caret = (event.currentTarget as HTMLInputElement).selectionStart ?? manager.query.length;
  }

  function keydown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === '/') {
      event.preventDefault();
      manager.cycleMode();
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        manager.move(event.key === 'ArrowDown' ? 1 : -1);
        break;
      }
      case 'Home':
      case 'End': {
        event.preventDefault();
        manager.moveTo(event.key === 'Home' ? 'start' : 'end');
        break;
      }
      case 'Enter': {
        event.preventDefault();
        void manager.activate();
        break;
      }
      case 'Escape': {
        event.preventDefault();
        if (manager.query) {
          manager.setQuery('');
        } else {
          manager.close();
        }
        break;
      }
      default: {
        if ((event.key === 'Delete' || event.key === 'Backspace') && !manager.query) {
          const active = manager.activeResult;
          if (active?.kind === 'recent') {
            event.preventDefault();
            manager.removeRecent(active.item.id);
          }
        }
      }
    }
  }
</script>

<div
  class="relative min-w-0 flex-1"
  use:clickOutside={{
    onOutclick: () => manager.presentation === 'dropdown' && manager.close(),
  }}
>
  <div
    class="flex h-10 w-full items-center gap-3 rounded-2xl border border-gray-300/80 bg-gray-100/90 px-3 text-immich-fg/70 shadow-sm transition hover:border-primary/50 md:h-11 dark:border-immich-dark-gray dark:bg-immich-dark-gray/70 dark:text-immich-dark-fg/70"
  >
    <Icon icon={mdiMagnify} size="20" />
    <input
      bind:this={input}
      value={manager.presentation === 'dropdown' && manager.isOpen ? manager.query : ''}
      class="min-w-0 flex-1 bg-transparent text-sm outline-none"
      aria-label={$t('search_your_photos')}
      aria-controls="global-search-dropdown"
      aria-expanded={manager.presentation === 'dropdown' && manager.isOpen}
      aria-activedescendant={manager.activeResult ? `global-search-dropdown-${manager.activeResult.id}` : undefined}
      placeholder="Search photos…  @ people  # tags  / albums  > commands"
      maxlength="256"
      onfocus={open}
      onclick={(event) => {
        open();
        syncCaret(event);
      }}
      oninput={(event) =>
        manager.setQuery(
          event.currentTarget.value,
          event.currentTarget.selectionStart ?? event.currentTarget.value.length,
        )}
      onkeyup={syncCaret}
      onpointerup={syncCaret}
      onselect={syncCaret}
      onkeydown={keydown}
    />
    {#if manager.presentation === 'dropdown' && manager.isOpen}
      <button
        type="button"
        aria-label={$t(manager.query ? 'clear' : 'close')}
        onclick={() => (manager.query ? manager.setQuery('') : manager.close())}
      >
        <Icon icon={mdiClose} size="18" />
      </button>
    {:else}
      <kbd class="hidden rounded-md bg-white/70 px-2 py-1 text-xs sm:block dark:bg-black/20">
        {isApple ? '⌘K' : 'Ctrl K'}
      </kbd>
    {/if}
  </div>

  {#if manager.isOpen && manager.presentation === 'dropdown'}
    <div
      id="global-search-dropdown"
      bind:this={resultList}
      role="listbox"
      class="absolute inset-s-0 top-full z-50 mt-2 max-h-[65vh] w-full overflow-y-auto rounded-xl border border-gray-200 bg-white/95 p-2 shadow-2xl backdrop-blur-md dark:border-gray-700 dark:bg-immich-dark-bg/95"
    >
      {#if showProgress}
        <div class="h-0.5 animate-pulse bg-linear-to-r from-transparent via-primary to-transparent"></div>
      {/if}
      {#each manager.results as result, index (result.id)}
        <button
          id={`global-search-dropdown-${result.id}`}
          type="button"
          role="option"
          aria-selected={index === manager.activeIndex}
          data-active={index === manager.activeIndex}
          class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start {index === manager.activeIndex
            ? 'bg-primary/10 text-primary'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
          onmouseenter={() => (manager.activeIndex = index)}
          onclick={() => void manager.activate(result)}
        >
          <span class="truncate">
            {result.kind === 'recent'
              ? result.item.label
              : result.kind === 'navigation' || result.kind === 'command'
                ? $t(result.item.labelKey as never)
                : result.kind === 'search'
                  ? `Search for “${result.query}”`
                  : result.kind === 'typed'
                    ? result.item.label
                    : result.kind === 'photo'
                      ? result.item.originalFileName
                      : result.kind === 'album'
                        ? result.item.albumName
                        : result.kind === 'person'
                          ? result.item.name
                          : result.kind === 'place'
                            ? result.item.name
                            : result.item.value}
          </span>
        </button>
      {/each}
      {#if manager.smartSearchUnavailable}
        <p class="m-2 rounded-lg bg-gray-100 p-2 text-xs dark:bg-gray-800">
          Smart search is unavailable.
          <button type="button" class="ms-2 text-primary" onclick={() => manager.setMode('metadata')}>
            Try Filename mode
          </button>
        </p>
      {/if}
      {#each Object.entries(manager.providerErrors) as [name, message] (name)}
        <p class="px-3 py-1 text-xs text-red-600">{name}: {message}</p>
      {/each}
      <footer
        class="mt-2 flex items-center gap-1 border-t border-gray-200 pt-2 text-[11px] text-gray-500 dark:border-gray-700"
      >
        {#each ['smart', 'metadata', 'description', 'ocr'] as mode (mode)}
          <button
            type="button"
            disabled={manager.scope !== 'all'}
            aria-pressed={manager.mode === mode}
            class="rounded-full px-2 py-1 {manager.mode === mode
              ? 'bg-primary text-white'
              : 'bg-gray-100 dark:bg-gray-800'}"
            onclick={() => manager.setMode(mode as 'smart' | 'metadata' | 'description' | 'ocr')}
          >
            {mode === 'metadata' ? 'Filename' : mode[0].toUpperCase() + mode.slice(1)}
          </button>
        {/each}
        <span class="ms-auto">@ # / &gt;</span>
      </footer>
      <span class="sr-only" aria-live="polite">{manager.results.length} results</span>
    </div>
  {/if}
</div>
