<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { globalSearchManager as manager, type GlobalSearchResult } from '$lib/managers/global-search-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { getAssetMediaUrl, getPeopleThumbnailUrl } from '$lib/utils';
  import { Icon, IconButton } from '@immich/ui';
  import {
    mdiAccount,
    mdiAlbum,
    mdiArrowRight,
    mdiClose,
    mdiImageOutline,
    mdiMagnify,
    mdiMapMarker,
    mdiTagOutline,
  } from '@mdi/js';
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';

  let input = $state<HTMLInputElement>();
  let list = $state<HTMLDivElement>();
  let dialog = $state<HTMLDivElement>();
  let showProgress = $state(false);
  const modeLabels = { smart: 'Smart', metadata: 'Filename', description: 'Description', ocr: 'OCR' };
  const activeResult = $derived(manager.activeResult);
  const activePreviewUrl = $derived(previewUrl(activeResult));

  $effect(() => {
    const isModalOpen = manager.isOpen && manager.presentation === 'modal';
    if (isModalOpen) {
      void tick().then(() => {
        if (manager.isOpen && manager.presentation === 'modal') {
          input?.focus();
        }
      });
    }
  });

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
        list?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  function globalKeydown(event: KeyboardEvent) {
    if (!authManager.authenticated || !featureFlagsManager.value.search) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLocaleLowerCase() === 'k') {
      event.preventDefault();
      event.stopImmediatePropagation();
      manager.toggle('modal');
    }
  }

  function inputKeydown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === '/') {
      event.preventDefault();
      manager.cycleMode();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !manager.query) {
      const active = manager.activeResult;
      if (active?.kind === 'recent') {
        event.preventDefault();
        manager.removeRecent(active.item.id);
        return;
      }
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
      // No default
    }
  }

  function dialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      manager.close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = [
      ...(dialog?.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])') ?? []),
    ].filter((element) => {
      if (element.matches(':disabled')) {
        return false;
      }
      const checkVisibility = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
      if (typeof checkVisibility === 'function') {
        return checkVisibility.call(element);
      }
      return !element.closest('[hidden], [aria-hidden="true"], .hidden');
    });
    if (focusable.length === 0) {
      return;
    }
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? (index - 1 + focusable.length) % focusable.length : (index + 1) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus();
  }

  onMount(() => {
    globalThis.addEventListener('keydown', globalKeydown, { capture: true });
    return () => globalThis.removeEventListener('keydown', globalKeydown, { capture: true });
  });

  function iconFor(result: GlobalSearchResult) {
    switch (result.kind) {
      case 'photo': {
        return mdiImageOutline;
      }
      case 'album': {
        return mdiAlbum;
      }
      case 'person': {
        return mdiAccount;
      }
      case 'place': {
        return mdiMapMarker;
      }
      case 'tag': {
        return mdiTagOutline;
      }
      default: {
        return mdiArrowRight;
      }
    }
  }

  function labelFor(result: GlobalSearchResult) {
    switch (result.kind) {
      case 'photo': {
        return result.item.originalFileName;
      }
      case 'album': {
        return result.item.albumName;
      }
      case 'person': {
        return result.item.name || $t('person');
      }
      case 'place': {
        return result.item.name;
      }
      case 'tag': {
        return result.item.value;
      }
      case 'command':
      case 'navigation': {
        return $t(result.item.labelKey as never);
      }
      case 'search': {
        return `Search for “${result.query}”`;
      }
      case 'recent': {
        return result.item.label;
      }
      case 'typed': {
        return result.item.label;
      }
    }
  }

  function sectionFor(result: GlobalSearchResult) {
    switch (result.kind) {
      case 'search': {
        return 'Top result';
      }
      case 'photo': {
        return 'Photos';
      }
      case 'album': {
        return 'Albums';
      }
      case 'person': {
        return 'People';
      }
      case 'place': {
        return 'Places';
      }
      case 'tag': {
        return 'Tags';
      }
      case 'command': {
        return 'Commands';
      }
      case 'navigation': {
        return result.item.category === 'system'
          ? 'System Settings'
          : result.item.category === 'admin'
            ? 'Administration'
            : manager.query.trim()
              ? 'Navigation'
              : 'Quick Links';
      }
      case 'recent': {
        return 'Recent';
      }
      case 'typed': {
        return 'Suggestions';
      }
    }
  }

  function previewUrl(result: GlobalSearchResult | undefined) {
    if (result?.kind === 'photo') {
      return getAssetMediaUrl({ id: result.item.id, cacheKey: result.item.thumbhash });
    }
    if (result?.kind === 'album' && result.item.albumThumbnailAssetId) {
      return getAssetMediaUrl({ id: result.item.albumThumbnailAssetId });
    }
    if (result?.kind === 'person') {
      return getPeopleThumbnailUrl(result.item);
    }
  }
</script>

{#if manager.isOpen && manager.presentation === 'modal' && authManager.authenticated && featureFlagsManager.value.search}
  <div
    class="fixed inset-0 z-1001 flex items-stretch justify-center bg-black/45 p-0 backdrop-blur-[2px] sm:items-start sm:px-3 sm:pt-[8vh]"
    role="presentation"
    onmousedown={(event) => event.target === event.currentTarget && manager.close()}
  >
    <div
      role="dialog"
      tabindex="-1"
      bind:this={dialog}
      aria-modal="true"
      aria-label={$t('search')}
      onkeydown={dialogKeydown}
      class="flex size-full max-h-none max-w-4xl flex-col overflow-hidden border border-gray-300 bg-white shadow-2xl sm:h-auto sm:max-h-[82vh] sm:rounded-2xl dark:border-gray-700 dark:bg-immich-dark-gray"
    >
      {#if showProgress}
        <div class="h-1 animate-pulse bg-linear-to-r from-primary/20 via-primary to-primary/20"></div>
      {/if}
      <div class="flex items-center gap-2 border-b border-gray-200 px-4 dark:border-gray-700">
        <Icon icon={mdiMagnify} size="24" />
        <input
          bind:this={input}
          value={manager.query}
          aria-label={$t('search_your_photos')}
          aria-controls="global-search-results"
          aria-activedescendant={manager.activeResult ? `global-search-${manager.activeResult.id}` : undefined}
          placeholder="Search photos…  @ people  # tags  / albums  > commands"
          maxlength="256"
          class="h-16 min-w-0 flex-1 bg-transparent text-base outline-none"
          oninput={(event) => {
            const target = event.currentTarget;
            manager.setQuery(target.value, target.selectionStart ?? target.value.length);
          }}
          onclick={(event) => manager.setInputCaret(event.currentTarget.selectionStart)}
          onkeyup={(event) => manager.setInputCaret(event.currentTarget.selectionStart)}
          onpointerup={(event) => manager.setInputCaret(event.currentTarget.selectionStart)}
          onselect={(event) => manager.setInputCaret(event.currentTarget.selectionStart)}
          onkeydown={inputKeydown}
        />
        <IconButton
          icon={mdiClose}
          aria-label={$t('close')}
          size="small"
          variant="ghost"
          onclick={() => manager.close()}
        />
      </div>

      <div class="flex min-h-0 flex-1">
        <div id="global-search-results" bind:this={list} class="min-w-0 flex-1 overflow-y-auto p-2" role="listbox">
          {#if manager.typedIssues.length > 0}
            {#each manager.typedIssues as issue (`${issue.raw}:${issue.message}`)}
              <p
                class="m-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
              >
                {issue.message}
              </p>
            {/each}
          {/if}
          {#if manager.smartSearchUnavailable}
            <p class="m-2 rounded-lg bg-gray-100 p-2 text-xs dark:bg-gray-800">
              Smart search is unavailable.
              <button type="button" class="ms-2 text-primary" onclick={() => manager.setMode('metadata')}
                >Try Filename mode</button
              >
            </p>
          {/if}
          {#each manager.results as result, index (result.id)}
            {@const section =
              index === 0 &&
              manager.scope === 'all' &&
              (result.kind === 'command' || result.kind === 'navigation' || result.kind === 'search')
                ? 'Top result'
                : sectionFor(result)}
            {@const previousSection =
              index === 1 &&
              manager.scope === 'all' &&
              (manager.results[0]?.kind === 'command' ||
                manager.results[0]?.kind === 'navigation' ||
                manager.results[0]?.kind === 'search')
                ? 'Top result'
                : index > 0
                  ? sectionFor(manager.results[index - 1])
                  : undefined}
            {#if index === 0 || previousSection !== section}
              <div class="px-3 pt-3 pb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">{section}</div>
            {/if}
            <button
              type="button"
              id={`global-search-${result.id}`}
              role="option"
              aria-selected={index === manager.activeIndex}
              data-active={index === manager.activeIndex}
              class="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start {index ===
              manager.activeIndex
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
              onmouseenter={() => (manager.activeIndex = index)}
              onclick={() => void manager.activate(result)}
            >
              {#if result.kind === 'photo'}
                <img
                  class="size-10 rounded-lg object-cover"
                  src={getAssetMediaUrl({ id: result.item.id, cacheKey: result.item.thumbhash })}
                  alt=""
                />
              {:else if result.kind === 'person'}
                <img class="size-10 rounded-full object-cover" src={getPeopleThumbnailUrl(result.item)} alt="" />
              {:else}
                <span class="flex size-10 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                  <Icon
                    icon={result.kind === 'command' || result.kind === 'navigation'
                      ? result.item.icon
                      : iconFor(result)}
                    size="21"
                  />
                </span>
              {/if}
              <span class="min-w-0 flex-1 truncate">{labelFor(result)}</span>
              {#if result.kind === 'recent'}
                <IconButton
                  icon={mdiClose}
                  title={$t('remove')}
                  aria-label={$t('remove')}
                  size="small"
                  variant="ghost"
                  onclick={(event: MouseEvent) => {
                    event.stopPropagation();
                    manager.removeRecent(result.item.id);
                  }}
                />
              {/if}
            </button>
          {/each}
          {#if manager.results.length === 0 && !manager.loading}
            <p class="p-8 text-center text-sm text-gray-500">{$t('no_results')}</p>
          {/if}
          {#each Object.entries(manager.sections) as [name, status] (name)}
            {#if status.status === 'error'}
              <p class="px-3 py-1 text-xs text-red-600">{name}: {status.message}</p>
            {/if}
          {/each}
          {#each Object.entries(manager.providerErrors) as [name, message] (name)}
            <p class="px-3 py-1 text-xs text-red-600">{name}: {message}</p>
          {/each}
          <span class="sr-only" aria-live="polite">{manager.results.length} results</span>
        </div>

        <aside class="hidden w-72 shrink-0 border-l border-gray-200 p-5 lg:block dark:border-gray-700">
          {#if activePreviewUrl}
            <img class="mb-4 aspect-square w-full rounded-xl object-cover" src={activePreviewUrl} alt="" />
          {/if}
          {#if activeResult}
            <p class="font-semibold">{labelFor(activeResult)}</p>
            <p class="mt-1 text-sm text-gray-500">{sectionFor(activeResult)}</p>
            {#if activeResult.kind === 'photo'}
              <dl class="mt-4 space-y-2 text-xs text-gray-500">
                <div>
                  <dt class="font-medium">Search text</dt>
                  <dd>{manager.typedPlainQuery || manager.query}</dd>
                </div>
                <div>
                  <dt class="font-medium">Created</dt>
                  <dd>{new Date(activeResult.item.fileCreatedAt).toLocaleString()}</dd>
                </div>
              </dl>
            {:else if activeResult.kind === 'album'}
              <p class="mt-3 text-sm text-gray-500">{activeResult.item.assetCount} assets</p>
            {:else if activeResult.kind === 'place'}
              <p class="mt-3 text-sm text-gray-500">{activeResult.item.latitude}, {activeResult.item.longitude}</p>
            {/if}
            <button
              type="button"
              class="mt-4 rounded-lg bg-primary px-3 py-2 text-sm text-white"
              onclick={() => void manager.activate(activeResult)}>Open</button
            >
          {:else}
            <p class="text-sm text-gray-500">Select a result to preview it.</p>
          {/if}
        </aside>
      </div>

      <footer
        class="flex items-center gap-4 border-t border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700"
      >
        <span class="hidden md:inline">↑↓ Navigate · ↵ Open · Esc Close · @ # / &gt;</span>
        <div class="ms-auto flex gap-1 opacity-{manager.scope === 'all' ? '100' : '40'}">
          {#each Object.entries(modeLabels) as [mode, label] (mode)}
            <button
              type="button"
              aria-pressed={manager.mode === mode}
              disabled={manager.scope !== 'all'}
              class="rounded-full px-2 py-1 {manager.mode === mode
                ? 'bg-primary text-white'
                : 'bg-gray-100 dark:bg-gray-800'}"
              onclick={() => manager.setMode(mode as keyof typeof modeLabels)}>{label}</button
            >
          {/each}
          <kbd class="p-1">Ctrl+/</kbd>
        </div>
      </footer>
    </div>
  </div>
{/if}
