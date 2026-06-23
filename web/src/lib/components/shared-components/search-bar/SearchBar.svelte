<script lang="ts">
  import { goto } from '$app/navigation';
  import { focusOutside } from '$lib/actions/focus-outside';
  import { shortcuts } from '$lib/actions/shortcut';
  import SearchFilterModal from '$lib/modals/SearchFilterModal.svelte';
  import { Route } from '$lib/route';
  import { searchStore } from '$lib/stores/search.svelte';
  import { handlePromiseError } from '$lib/utils';
  import { generateId } from '$lib/utils/generate-id';
  import { storeTypedSearchDisplayText } from '$lib/utils/typed-search/typed-search-display-cache';
  import {
    isLiveTypedSearchToken,
    resolveLiveTypedSearchSuggestions,
    type LiveTypedSearchChoice,
    type LiveTypedSearchStatus,
    type LiveTypedSearchToken,
  } from '$lib/utils/typed-search/typed-search-live-suggestions';
  import {
    getActiveTypedSearchToken,
    parseTypedSearch,
    rewriteTypedSearchToken,
    type TypedSearchDisplayToken,
    type TypedSearchIssue,
    type TypedSearchParseResult,
  } from '$lib/utils/typed-search/typed-search-parser';
  import { resolveTypedSearchFilters, type TypedSearchChoice } from '$lib/utils/typed-search/typed-search-resolver';
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
  let typedSearchDisplayTokens = $state<TypedSearchDisplayToken[]>([]);
  let typedSearchIssues = $state<TypedSearchIssue[]>([]);
  let typedSearchChoices = $state<TypedSearchChoice[]>([]);
  const selectedChoices = new SvelteMap<string, TypedSearchChoice>();
  let activeInlineToken = $state<LiveTypedSearchToken>();
  let liveTypedSearchStatus = $state<LiveTypedSearchStatus>({ status: 'idle' });
  let caret = $state<number | null>(0);
  let isComposing = $state(false);
  let skipNextLiveSuggestionsForCaret: number | null = null;
  let liveSuggestionTimer: ReturnType<typeof setTimeout> | undefined;
  let liveSuggestionController: AbortController | undefined;
  let liveSuggestionRequestId = 0;

  let showInlineSuggestions = $derived(
    typedSearchDisplayTokens.length > 0 ||
      typedSearchIssues.length > 0 ||
      typedSearchChoices.length > 0 ||
      liveTypedSearchStatus.status !== 'idle',
  );
  let isSearchSuggestions = $derived(showInlineSuggestions || hasHistorySuggestions);

  const listboxId = generateId();
  const searchTypeId = generateId();

  onDestroy(() => {
    searchStore.isSearchEnabled = false;
    clearLiveSuggestionRequest();
  });

  const handleSearch = async (payload: SmartSearchDto | MetadataSearchDto, displayText?: string) => {
    closeDropdown();
    searchStore.isSearchEnabled = false;
    const destination = Route.search(payload);
    if (displayText) {
      storeTypedSearchDisplayText(destination, displayText);
    }
    await goto(destination);
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

  function applyParsedState(parsed: TypedSearchParseResult) {
    typedSearchDisplayTokens = parsed.displayTokens.map((displayToken) => {
      const selected =
        (displayToken.identity ? selectedChoices.get(displayToken.identity) : undefined) ??
        [...selectedChoices.values()].find((choice) => choice.tokenRaw === displayToken.raw);
      return selected && (displayToken.key === 'person' || displayToken.key === 'tag')
        ? { ...displayToken, value: selected.label, status: 'resolved-entity' as const }
        : displayToken;
    });
    typedSearchIssues = [];
    typedSearchChoices = [];

    for (const key of selectedChoices.keys()) {
      if (
        !parsed.resolutionTokens.some(
          (token) => token.raw === key || token.identity === key || token.stableIdentity === key,
        )
      ) {
        selectedChoices.delete(key);
      }
    }
  }

  function parseTypedSearchDraft() {
    const parsed = parseTypedSearch(value, { mode: 'draft' });
    applyParsedState(parsed);
    updateActiveTypedSearchToken(parsed);
    return parsed;
  }

  function clearTypedSearchDraft() {
    typedSearchDisplayTokens = [];
    typedSearchIssues = [];
    typedSearchChoices = [];
    selectedChoices.clear();
    activeInlineToken = undefined;
    caret = 0;
    isComposing = false;
    skipNextLiveSuggestionsForCaret = null;
    resetLiveTypedSearchSuggestions();
  }

  function clearLiveSuggestionRequest() {
    if (liveSuggestionTimer) {
      clearTimeout(liveSuggestionTimer);
      liveSuggestionTimer = undefined;
    }
    liveSuggestionController?.abort();
    liveSuggestionController = undefined;
  }

  function resetLiveTypedSearchSuggestions() {
    clearLiveSuggestionRequest();
    liveSuggestionRequestId++;
    liveTypedSearchStatus = { status: 'idle' };
  }

  function scheduleLiveTypedSearchSuggestions(parsed: TypedSearchParseResult) {
    if (!activeInlineToken || isComposing) {
      resetLiveTypedSearchSuggestions();
      return;
    }
    if (skipNextLiveSuggestionsForCaret === caret) {
      skipNextLiveSuggestionsForCaret = null;
      resetLiveTypedSearchSuggestions();
      return;
    }

    clearLiveSuggestionRequest();
    const requestId = ++liveSuggestionRequestId;
    const token = activeInlineToken;
    liveTypedSearchStatus = { status: 'loading', key: token.key };
    liveSuggestionTimer = setTimeout(() => {
      liveSuggestionTimer = undefined;
      const controller = new AbortController();
      liveSuggestionController = controller;
      const timeoutSignal = AbortSignal.timeout(15_000);
      const signal = AbortSignal.any([controller.signal, timeoutSignal]);

      resolveLiveTypedSearchSuggestions({ parsed, activeToken: token, signal })
        .then((status) => {
          if (requestId !== liveSuggestionRequestId) {
            return;
          }
          if (timeoutSignal.aborted) {
            liveTypedSearchStatus = { status: 'timeout', key: token.key };
          } else if (!signal.aborted) {
            liveTypedSearchStatus = status;
          }
        })
        .catch((error: unknown) => {
          if (requestId !== liveSuggestionRequestId) {
            return;
          }
          if (timeoutSignal.aborted) {
            liveTypedSearchStatus = { status: 'timeout', key: token.key };
          } else if (!(error instanceof Error && error.name === 'AbortError')) {
            liveTypedSearchStatus = {
              status: 'error',
              key: token.key,
              message: error instanceof Error ? error.message : 'Unable to load filter matches',
            };
          }
        })
        .finally(() => {
          if (liveSuggestionController === controller) {
            liveSuggestionController = undefined;
          }
        });
    }, 150);
  }

  function updateActiveTypedSearchToken(parsed = parseTypedSearch(value, { mode: 'draft' })) {
    if (isComposing) {
      activeInlineToken = undefined;
      resetLiveTypedSearchSuggestions();
      return;
    }

    const token = getActiveTypedSearchToken(parsed, caret);
    activeInlineToken = isLiveTypedSearchToken(token) && token.issue?.code !== 'unterminated-quote' ? token : undefined;
    scheduleLiveTypedSearchSuggestions(parsed);
  }

  function selectTypedSearchChoice(choice: TypedSearchChoice) {
    selectedChoices.set(choice.tokenIdentity, choice);
    typedSearchIssues = typedSearchIssues.filter((issue) => issue.tokenIdentity !== choice.tokenIdentity);
    typedSearchChoices = typedSearchChoices.filter((item) => item.tokenIdentity !== choice.tokenIdentity);
    typedSearchDisplayTokens = typedSearchDisplayTokens.map((token) =>
      token.identity === choice.tokenIdentity
        ? { ...token, value: choice.label, status: 'resolved-entity' as const }
        : token,
    );
  }

  async function selectLiveTypedSearchChoice(choice: LiveTypedSearchChoice) {
    const token = activeInlineToken;
    if (!token) {
      return;
    }

    const { text, caret: rewrittenCaret } = rewriteTypedSearchToken(value, token, {
      key: choice.key,
      value: choice.value,
    });
    const needsSeparator = text[rewrittenCaret] === undefined || !/\s/.test(text[rewrittenCaret]);
    value = needsSeparator ? `${text.slice(0, rewrittenCaret)} ${text.slice(rewrittenCaret)}` : text;
    const nextCaret = needsSeparator ? rewrittenCaret + 1 : rewrittenCaret;
    caret = nextCaret;
    skipNextLiveSuggestionsForCaret = nextCaret;

    const parsed = parseTypedSearch(value, { mode: 'draft' });
    const rewrittenToken = getActiveTypedSearchToken(parsed, rewrittenCaret);
    if (
      rewrittenToken &&
      (choice.key === 'person' || choice.key === 'tag') &&
      choice.entityId &&
      rewrittenToken.key === choice.key
    ) {
      const selectedChoice: TypedSearchChoice = {
        tokenRaw: rewrittenToken.raw,
        key: choice.key,
        id: choice.entityId,
        label: choice.label,
        value: rewrittenToken.value,
        tokenIdentity: `${choice.key}#0`,
      };
      const resolvedToken = parsed.resolutionTokens.find(
        (item) => item.start === rewrittenToken.start && item.end === rewrittenToken.end,
      );
      selectedChoice.tokenIdentity = resolvedToken?.stableIdentity ?? selectedChoice.tokenIdentity;
      selectedChoices.set(selectedChoice.tokenIdentity, selectedChoice);
    }

    applyParsedState(parsed);
    activeInlineToken = undefined;
    resetLiveTypedSearchSuggestions();
    await tick();
    input?.focus();
    input?.setSelectionRange(nextCaret, nextCaret);
  }

  const submitSearch = async (term: string, saveTerm = true) => {
    const parsed = parseTypedSearch(term);
    applyParsedState(parsed);
    if (parsed.issues.length > 0) {
      typedSearchIssues = parsed.issues;
      openDropdown();
      return;
    }

    const result = await resolveTypedSearchFilters(parsed, { selectedChoices });
    if (!result.ok) {
      typedSearchIssues = result.issues;
      typedSearchChoices = result.choices;
      typedSearchDisplayTokens = parsed.displayTokens.map((token) => {
        const issue = result.issues.find((item) => item.raw === token.raw);
        return issue ? { ...token, status: 'error' as const, issue } : token;
      });
      openDropdown();
      return;
    }

    typedSearchIssues = [];
    typedSearchChoices = [];
    if (saveTerm) {
      saveSearchTerm(term);
    }
    await handleSearch({ ...buildSearchPayload(result.queryText), ...result.filters }, term);
  };

  const onSubmit = () => {
    handlePromiseError(submitSearch(value));
  };

  const onClear = () => {
    value = '';
    clearTypedSearchDraft();
    input?.focus();
  };

  const onEscape = () => {
    typedSearchIssues = [];
    typedSearchChoices = [];
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

  const onInputKeyDown = (event: KeyboardEvent) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && showInlineSuggestions) {
      event.preventDefault();
      event.stopPropagation();
      inlineSearchFilterBox?.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && showInlineSuggestions) {
      if (inlineSearchFilterBox?.selectActiveOption()) {
        event.preventDefault();
        event.stopPropagation();
      }
    } else if (event.key === 'Enter' && selectedId) {
      event.preventDefault();
      searchHistoryBox?.selectActiveOption();
    }
  };

  const onInput = (event: Event) => {
    caret = (event.currentTarget as HTMLInputElement).selectionStart ?? value.length;
    openDropdown();
    searchHistoryBox?.clearSelection();
    inlineSearchFilterBox?.clearSelection();
    parseTypedSearchDraft();
  };

  const updateCaret = (event: Event) => {
    caret = (event.currentTarget as HTMLInputElement).selectionStart ?? value.length;
    updateActiveTypedSearchToken();
  };

  const updateCaretAfterKeyUp = (event: KeyboardEvent) => {
    if (
      (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      liveTypedSearchStatus.status === 'ok' &&
      liveTypedSearchStatus.items.length > 0
    ) {
      return;
    }
    updateCaret(event);
  };

  const onCompositionStart = () => {
    isComposing = true;
    updateActiveTypedSearchToken();
  };

  const onCompositionEnd = (event: CompositionEvent) => {
    isComposing = false;
    updateCaret(event);
  };

  const openDropdown = () => {
    showSuggestions = true;
  };

  const closeDropdown = () => {
    showSuggestions = false;
    searchHistoryBox?.clearSelection();
    inlineSearchFilterBox?.clearSelection();
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
    parseTypedSearchDraft();
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
        onkeyup={updateCaretAfterKeyUp}
        onselect={updateCaret}
        onpointerup={updateCaret}
        oncompositionstart={onCompositionStart}
        oncompositionend={onCompositionEnd}
        onkeydown={onInputKeyDown}
        role="combobox"
        aria-controls={listboxId}
        aria-activedescendant={selectedId ?? ''}
        aria-expanded={showSuggestions && isSearchSuggestions}
        aria-autocomplete="list"
        aria-describedby={searchTypeId}
        use:shortcuts={[
          { shortcut: { key: 'Escape' }, onShortcut: onEscape },
          { shortcut: { ctrl: true, shift: true, key: 'k' }, onShortcut: onFilterClick },
          { shortcut: { key: 'ArrowUp' }, onShortcut: () => !showInlineSuggestions && onArrow(-1) },
          { shortcut: { key: 'ArrowDown' }, onShortcut: () => !showInlineSuggestions && onArrow(1) },
          { shortcut: { key: 'ArrowDown', alt: true }, onShortcut: openDropdown },
        ]}
      />

      <InlineSearchFilterBox
        bind:this={inlineSearchFilterBox}
        id={listboxId}
        isOpen={showSuggestions && showInlineSuggestions}
        status={liveTypedSearchStatus}
        tokens={typedSearchDisplayTokens}
        issues={typedSearchIssues}
        choices={typedSearchChoices}
        onSelectLive={(choice) => handlePromiseError(selectLiveTypedSearchChoice(choice))}
        onSelectChoice={selectTypedSearchChoice}
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
