<script lang="ts">
  import { goto } from '$app/navigation';
  import { focusOutside } from '$lib/actions/focus-outside';
  import { shortcuts } from '$lib/actions/shortcut';
  import SearchFilterModal from '$lib/modals/SearchFilterModal.svelte';
  import { Route } from '$lib/route';
  import { searchStore } from '$lib/stores/search.svelte';
  import { handlePromiseError } from '$lib/utils';
  import { generateId } from '$lib/utils/generate-id';
  import {
    getLiveTypedSearchSuggestions,
    isLiveTypedSearchToken,
  } from '$lib/utils/typed-search/typed-search-live-suggestions';
  import {
    getActiveTypedSearchToken,
    parseTypedSearch,
    rewriteTypedSearchToken,
    type TypedSearchTokenSpan,
  } from '$lib/utils/typed-search/typed-search-parser';
  import {
    resolveTypedSearchFilters,
    typedSearchChoiceKey,
    type TypedSearchChoice,
  } from '$lib/utils/typed-search/typed-search-resolver';
  import type { MetadataSearchDto, SmartSearchDto } from '@immich/sdk';
  import { Button, IconButton, modalManager } from '@immich/ui';
  import { mdiClose, mdiMagnify, mdiTune } from '@mdi/js';
  import { onDestroy, onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { SvelteMap } from 'svelte/reactivity';
  import InlineSearchFilterBox from './InlineSearchFilterBox.svelte';
  import SearchHistoryBox from './SearchHistoryBox.svelte';

  type Props = {
    value?: string;
    grayTheme: boolean;
    searchQuery?: MetadataSearchDto | SmartSearchDto;
  };

  let { value = $bindable(''), grayTheme, searchQuery = {} }: Props = $props();

  let showClearIcon = $derived(value.length > 0);

  let input = $state<HTMLInputElement>();
  let searchHistoryBox = $state<ReturnType<typeof SearchHistoryBox>>();
  let inlineSearchFilterBox = $state<ReturnType<typeof InlineSearchFilterBox>>();
  let showSuggestions = $state(false);
  let hasHistorySuggestions = $state(false);
  let selectedId: string | undefined = $state();
  let close: (() => Promise<void>) | undefined;
  let showSearchTypeDropdown = $state(false);
  let currentSearchType = $state('smart');
  let caret = $state(0);
  let activeInlineToken: TypedSearchTokenSpan | undefined = $state();
  let liveChoices: TypedSearchChoice[] = $state([]);
  let commitChoices: TypedSearchChoice[] = $state([]);
  let liveMessage: string | undefined = $state();
  let validationMessage: string | undefined = $state();
  let isLoadingInlineChoices = $state(false);
  const selectedChoices = new SvelteMap<string, TypedSearchChoice>();

  let inlineChoices = $derived(commitChoices.length > 0 ? commitChoices : liveChoices);
  let inlineMessage = $derived(validationMessage ?? liveMessage);
  let showInlineSuggestions = $derived(Boolean(activeInlineToken || validationMessage || commitChoices.length > 0));
  let isSearchSuggestions = $derived(showInlineSuggestions || hasHistorySuggestions);

  const listboxId = generateId();
  const searchTypeId = generateId();

  onDestroy(() => {
    searchStore.isSearchEnabled = false;
  });

  $effect(() => {
    const parsed = parseTypedSearch(value, { mode: 'draft' });
    const token = getActiveTypedSearchToken(parsed, caret);
    const activeToken = isLiveTypedSearchToken(token) ? token : undefined;
    activeInlineToken = activeToken;
    liveChoices = [];
    liveMessage = undefined;

    if (!activeToken) {
      isLoadingInlineChoices = false;
      return;
    }

    const controller = new AbortController();
    isLoadingInlineChoices = true;
    const timeout = setTimeout(() => {
      getLiveTypedSearchSuggestions(parsed, activeToken, controller.signal)
        .then((choices) => {
          liveChoices = choices;
          liveMessage = choices.length === 0 ? `No matching ${activeToken.key} found` : undefined;
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error && error.name === 'AbortError')) {
            liveMessage = error instanceof Error ? error.message : 'Unable to load filter suggestions';
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            isLoadingInlineChoices = false;
          }
        });
    }, 150);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  });

  const handleSearch = async (payload: SmartSearchDto | MetadataSearchDto) => {
    closeDropdown();
    searchStore.isSearchEnabled = false;
    await goto(Route.search(payload));
  };

  const clearSearchTerm = (searchTerm: string) => {
    input?.focus();
    searchStore.savedSearchTerms = searchStore.savedSearchTerms.filter((item) => item !== searchTerm);
  };

  const saveSearchTerm = (saveValue: string) => {
    const filteredSearchTerms = searchStore.savedSearchTerms.filter(
      (item) => item.toLowerCase() !== saveValue.toLowerCase(),
    );
    searchStore.savedSearchTerms = [saveValue, ...filteredSearchTerms];

    if (searchStore.savedSearchTerms.length > 5) {
      searchStore.savedSearchTerms = searchStore.savedSearchTerms.slice(0, 5);
    }
  };

  const clearAllSearchTerms = () => {
    input?.focus();
    searchStore.savedSearchTerms = [];
  };

  const onFocusIn = () => {
    searchStore.isSearchEnabled = true;
    getSearchType();
  };

  const onFocusOut = () => {
    searchStore.isSearchEnabled = false;
  };

  const buildSearchPayload = (term: string): SmartSearchDto | MetadataSearchDto => {
    const normalizedTerm = term.trim();
    if (!normalizedTerm) {
      return {};
    }

    const searchType = getSearchType();
    switch (searchType) {
      case 'smart': {
        return { query: normalizedTerm };
      }
      case 'metadata': {
        return { originalFileName: normalizedTerm };
      }
      case 'description': {
        return { description: normalizedTerm };
      }
      case 'fullPath': {
        return { originalPath: normalizedTerm };
      }
      case 'ocr': {
        return { ocr: normalizedTerm };
      }
      default: {
        return { query: normalizedTerm };
      }
    }
  };

  const onHistoryTermClick = async (searchTerm: string) => {
    value = searchTerm;
    await submitSearch(searchTerm, false);
  };

  const onFilterClick = async () => {
    value = '';

    if (close) {
      await close();
      close = undefined;
      searchStore.isSearchEnabled = false;
      return;
    }

    const result = modalManager.open(SearchFilterModal, { searchQuery });
    close = () => result.close();
    closeDropdown();

    const searchResult = await result.onClose;
    close = undefined;
    searchStore.isSearchEnabled = false;

    // Refresh search type after modal closes
    getSearchType();

    if (!searchResult) {
      return;
    }

    await handleSearch(searchResult);
  };

  const submitSearch = async (term: string, saveTerm = true) => {
    validationMessage = undefined;
    commitChoices = [];

    const parsed = parseTypedSearch(term);
    if (parsed.issues.length > 0) {
      validationMessage = parsed.issues[0].message;
      openDropdown();
      return;
    }

    isLoadingInlineChoices = true;
    const result = await resolveTypedSearchFilters(parsed, selectedChoices);
    isLoadingInlineChoices = false;
    if (!result.ok) {
      validationMessage = result.issues[0]?.message;
      commitChoices = result.choices;
      openDropdown();
      return;
    }

    if (saveTerm) {
      saveSearchTerm(term);
    }
    await handleSearch({ ...buildSearchPayload(parsed.queryText), ...result.filters });
  };

  const onSubmit = () => {
    handlePromiseError(submitSearch(value));
  };

  const onClear = () => {
    value = '';
    caret = 0;
    validationMessage = undefined;
    commitChoices = [];
    selectedChoices.clear();
    input?.focus();
  };

  const onEscape = () => {
    validationMessage = undefined;
    commitChoices = [];
    closeDropdown();
    closeSearchTypeDropdown();
  };

  const onArrow = async (direction: 1 | -1) => {
    openDropdown();
    await tick();
    if (showInlineSuggestions) {
      inlineSearchFilterBox?.moveSelection(direction);
    } else {
      searchHistoryBox?.moveSelection(direction);
    }
  };

  const onEnter = (event: KeyboardEvent) => {
    if (selectedId) {
      event.preventDefault();
      if (showInlineSuggestions) {
        inlineSearchFilterBox?.selectActiveOption();
      } else {
        searchHistoryBox?.selectActiveOption();
      }
    }
  };

  const onInput = (event: Event) => {
    caret = (event.currentTarget as HTMLInputElement).selectionStart ?? value.length;
    validationMessage = undefined;
    commitChoices = [];
    openDropdown();
    searchHistoryBox?.clearSelection();
    inlineSearchFilterBox?.clearSelection();
  };

  const updateCaret = (event: Event) => {
    caret = (event.currentTarget as HTMLInputElement).selectionStart ?? value.length;
  };

  const selectInlineChoice = async (choice: TypedSearchChoice) => {
    const parsed = parseTypedSearch(value, { mode: 'draft' });
    const token =
      parsed.tokens.find((item) => item.start === choice.tokenStart && item.end === choice.tokenEnd) ??
      (activeInlineToken?.key === choice.key && activeInlineToken.value === choice.value
        ? activeInlineToken
        : undefined) ??
      parsed.tokens.find((item) => item.key === choice.key && item.value === choice.value);
    if (!token) {
      return;
    }

    const rewritten = rewriteTypedSearchToken(value, token, { key: choice.key, value: choice.label });
    value = rewritten.text;
    caret = rewritten.caret;
    if (choice.key === 'person' || choice.key === 'tag' || choice.key === 'camera') {
      selectedChoices.set(typedSearchChoiceKey(choice.key, choice.label), choice);
    }
    validationMessage = undefined;
    commitChoices = [];
    await tick();
    input?.focus();
    input?.setSelectionRange(rewritten.caret, rewritten.caret);
  };

  const openDropdown = () => {
    showSuggestions = true;
  };

  const closeDropdown = () => {
    showSuggestions = false;
    searchHistoryBox?.clearSelection();
  };

  const toggleSearchTypeDropdown = () => {
    showSearchTypeDropdown = !showSearchTypeDropdown;
  };

  const closeSearchTypeDropdown = () => {
    showSearchTypeDropdown = false;
  };

  const selectSearchType = (type: string) => {
    localStorage.setItem('searchQueryType', type);
    currentSearchType = type;
    showSearchTypeDropdown = false;
    input?.focus();
  };

  const onsubmit = (event: Event) => {
    event.preventDefault();
    onSubmit();
  };

  function getSearchType() {
    const searchType = localStorage.getItem('searchQueryType');
    switch (searchType) {
      case 'smart':
      case 'metadata':
      case 'description':
      case 'fullPath':
      case 'ocr': {
        currentSearchType = searchType;
        return searchType;
      }
      default: {
        currentSearchType = 'smart';
        return 'smart';
      }
    }
  }

  function getSearchTypeText(): string {
    switch (currentSearchType) {
      case 'smart': {
        return $t('context');
      }
      case 'metadata': {
        return $t('filename');
      }
      case 'description': {
        return $t('description');
      }
      case 'fullPath': {
        return $t('full_path_or_folder');
      }
      case 'ocr': {
        return $t('ocr');
      }
      default: {
        return $t('context');
      }
    }
  }

  onMount(() => {
    getSearchType();
  });

  const searchTypes = [
    { value: 'smart', label: () => $t('context') },
    { value: 'metadata', label: () => $t('filename') },
    { value: 'description', label: () => $t('description') },
    { value: 'fullPath', label: () => $t('full_path_or_folder') },
    { value: 'ocr', label: () => $t('ocr') },
  ] as const;
</script>

<svelte:document
  use:shortcuts={[
    { shortcut: { ctrl: true, key: 'k' }, onShortcut: () => input?.select() },
    { shortcut: { ctrl: true, shift: true, key: 'k' }, onShortcut: onFilterClick },
  ]}
/>

<div class="relative z-auto w-full" use:focusOutside={{ onFocusOut }} tabindex="-1">
  <form
    draggable="false"
    autocomplete="off"
    class="text-sm select-text"
    action={Route.search()}
    onreset={() => (value = '')}
    {onsubmit}
    onfocusin={onFocusIn}
    role="search"
  >
    <div use:focusOutside={{ onFocusOut: closeDropdown }} tabindex="-1">
      <label for="main-search-bar" class="sr-only">{$t('search_your_photos')}</label>
      <input
        type="text"
        name="q"
        id="main-search-bar"
        class="w-full border-2 py-4 ps-14 text-immich-fg/75 transition-all max-md:py-2 dark:text-immich-dark-fg
        {showClearIcon ? 'pe-22.5' : 'pe-14'}
        {grayTheme ? 'dark:bg-immich-dark-gray' : 'dark:bg-immich-dark-bg'}
        {showSuggestions && isSearchSuggestions ? 'rounded-t-3xl' : 'rounded-3xl bg-gray-200'}
        {searchStore.isSearchEnabled ? 'border-gray-200 bg-white dark:border-gray-700' : 'border-transparent'}"
        placeholder={$t('search_your_photos')}
        required
        pattern="^(?!m:$).*$"
        bind:value
        bind:this={input}
        onfocus={openDropdown}
        oninput={onInput}
        onclick={updateCaret}
        onkeyup={updateCaret}
        role="combobox"
        aria-controls={listboxId}
        aria-activedescendant={selectedId ?? ''}
        aria-expanded={showSuggestions && isSearchSuggestions}
        aria-autocomplete="list"
        aria-describedby={searchTypeId}
        use:shortcuts={[
          { shortcut: { key: 'Escape' }, onShortcut: onEscape },
          { shortcut: { ctrl: true, shift: true, key: 'k' }, onShortcut: onFilterClick },
          { shortcut: { key: 'ArrowUp' }, onShortcut: () => onArrow(-1) },
          { shortcut: { key: 'ArrowDown' }, onShortcut: () => onArrow(1) },
          { shortcut: { key: 'Enter' }, onShortcut: onEnter, preventDefault: false },
          { shortcut: { key: 'ArrowDown', alt: true }, onShortcut: openDropdown },
        ]}
      />

      <InlineSearchFilterBox
        bind:this={inlineSearchFilterBox}
        id={listboxId}
        isOpen={showSuggestions && showInlineSuggestions}
        isLoading={isLoadingInlineChoices}
        choices={inlineChoices}
        message={inlineMessage}
        onSelect={(choice) => handlePromiseError(selectInlineChoice(choice))}
        onActiveSelectionChange={(id) => (selectedId = id)}
      />

      <SearchHistoryBox
        bind:this={searchHistoryBox}
        bind:isSearchSuggestions={hasHistorySuggestions}
        id={listboxId}
        searchQuery={value}
        isOpen={showSuggestions && !showInlineSuggestions}
        onClearAllSearchTerms={clearAllSearchTerms}
        onClearSearchTerm={(searchTerm) => clearSearchTerm(searchTerm)}
        onSelectSearchTerm={(searchTerm) => handlePromiseError(onHistoryTermClick(searchTerm))}
        onActiveSelectionChange={(id) => (selectedId = id)}
      />
    </div>

    <div
      id={searchTypeId}
      class="absolute inset-y-0 inset-e-16 flex items-center"
      class:max-md:hidden={value}
      class:inset-e-28={value.length > 0}
    >
      <div class="relative" use:focusOutside={{ onFocusOut: closeSearchTypeDropdown }}>
        <Button
          shape="round"
          variant={searchStore.isSearchEnabled ? 'filled' : 'outline'}
          color={searchStore.isSearchEnabled ? 'primary' : 'secondary'}
          class="px-3 py-1 text-xs {searchStore.isSearchEnabled
            ? 'border border-transparent'
            : 'border-secondary/5 border font-light text-muted hover:text-dark'}"
          onclick={toggleSearchTypeDropdown}
          aria-expanded={showSearchTypeDropdown}
          aria-haspopup="listbox"
        >
          {getSearchTypeText()}
        </Button>

        {#if showSearchTypeDropdown}
          <div
            class="absolute top-full right-0 z-9999 mt-1 min-w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-immich-dark-gray"
          >
            {#each searchTypes as searchType (searchType.value)}
              <button
                type="button"
                tabindex="0"
                class="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-gray-100 dark:hover:bg-gray-700
                         {currentSearchType === searchType.value ? 'bg-gray-100 dark:bg-gray-700' : ''}"
                onclick={() => selectSearchType(searchType.value)}
              >
                {searchType.label()}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if showClearIcon}
      <div class="absolute inset-y-0 inset-e-0 flex items-center pe-2">
        <IconButton
          onclick={onClear}
          icon={mdiClose}
          aria-label={$t('clear')}
          size="medium"
          color="secondary"
          variant="ghost"
          shape="round"
        />
      </div>
    {/if}
    <div class="absolute inset-y-0 inset-s-0 flex items-center ps-2">
      <IconButton
        type="submit"
        aria-label={$t('search')}
        icon={mdiMagnify}
        size="medium"
        onclick={() => {}}
        shape="round"
        color="secondary"
        variant="ghost"
      />
    </div>
  </form>

  <div class="absolute inset-y-0 {showClearIcon ? 'inset-e-14' : 'inset-e-2'} flex items-center ps-6 transition-all">
    <IconButton
      aria-label={$t('show_search_options')}
      shape="round"
      icon={mdiTune}
      onclick={onFilterClick}
      size="medium"
      color="secondary"
      variant="ghost"
    />
  </div>
</div>
