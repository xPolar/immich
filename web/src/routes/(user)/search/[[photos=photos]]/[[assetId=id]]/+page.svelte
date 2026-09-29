<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import ActionMenuItem from '$lib/components/ActionMenuItem.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
  import ControlAppBar from '$lib/components/shared-components/ControlAppBar.svelte';
  import SearchBar from '$lib/components/shared-components/search-bar/SearchBar.svelte';
  import ArchiveAction from '$lib/components/timeline/actions/ArchiveAction.svelte';
  import ChangeDate from '$lib/components/timeline/actions/ChangeDateAction.svelte';
  import ChangeDescription from '$lib/components/timeline/actions/ChangeDescriptionAction.svelte';
  import ChangeLocation from '$lib/components/timeline/actions/ChangeLocationAction.svelte';
  import CreateSharedLink from '$lib/components/timeline/actions/CreateSharedLinkAction.svelte';
  import DeleteAssets from '$lib/components/timeline/actions/DeleteAssetsAction.svelte';
  import DownloadAction from '$lib/components/timeline/actions/DownloadAction.svelte';
  import FavoriteAction from '$lib/components/timeline/actions/FavoriteAction.svelte';
  import SelectAllAssets from '$lib/components/timeline/actions/SelectAllAction.svelte';
  import SetVisibilityAction from '$lib/components/timeline/actions/SetVisibilityAction.svelte';
  import TagAction from '$lib/components/timeline/actions/TagAction.svelte';
  import AssetSelectControlBar from '$lib/components/timeline/AssetSelectControlBar.svelte';
  import Timeline from '$lib/components/timeline/Timeline.svelte';
  import { QueryParameter } from '$lib/constants';
  import { assetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import type { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
  import { Route } from '$lib/route';
  import { getAssetBulkActions } from '$lib/services/asset.service';
  import { lang, locale } from '$lib/stores/preferences.store';
  import { handlePromiseError } from '$lib/utils';
  import { parseUtcDate } from '$lib/utils/date-time';
  import { handleError } from '$lib/utils/handle-error';
  import { isAlbumsRoute, isPeopleRoute } from '$lib/utils/navigation';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import { getTypedSearchDisplayText } from '$lib/utils/typed-search/typed-search-display-cache';
  import {
    type AlbumResponseDto,
    getPerson,
    getTagById,
    type MetadataSearchDto,
    searchAssets,
    searchSmart,
    type SmartSearchDto,
  } from '@immich/sdk';
  import { ActionButton, CommandPaletteDefaultProvider, Icon, LoadingSpinner } from '@immich/ui';
  import { mdiArrowLeft, mdiClose, mdiDotsVertical, mdiImageOffOutline } from '@mdi/js';
  import { untrack } from 'svelte';
  import { t } from 'svelte-i18n';

  const SMART_SEARCH_PRELOAD_LIMIT = 500;
  const METADATA_SEARCH_PRELOAD_LIMIT = 10_000;
  const timelineOptions = { externalAssets: true };

  // Viewing an asset pushes its own history state, which causes weird
  // behavior for history.back(). To prevent that we store the previous page
  // manually and navigate back to that.
  let previousRoute = $state<string>(Route.explore());

  let timelineManager = $state<TimelineManager>() as TimelineManager;
  let nextPage = $state(1);
  let searchResultAlbums: AlbumResponseDto[] = $state([]);
  let isLoading = $state(true);
  let searchGeneration = 0;

  type SearchTerms = MetadataSearchDto & Pick<SmartSearchDto, 'query' | 'queryAssetId'>;
  let searchQuery = $derived(page.url.searchParams.get(QueryParameter.QUERY));
  let smartSearchEnabled = $derived(featureFlagsManager.value.smartSearch);
  let terms = $derived<SearchTerms>(searchQuery ? JSON.parse(searchQuery) : {});
  let searchDisplayValue = $derived(
    getTypedSearchDisplayText(page.url.pathname + page.url.search) ?? terms?.query ?? '',
  );
  let searchTermKeys = $derived(getObjectKeys(terms));
  let isSmartSearch = $derived(('query' in terms || 'queryAssetId' in terms) && smartSearchEnabled);
  let preloadLimit = $derived(isSmartSearch ? SMART_SEARCH_PRELOAD_LIMIT : METADATA_SEARCH_PRELOAD_LIMIT);
  let isNearTimelineEnd = $derived(
    timelineManager.viewportHeight > 0 &&
      timelineManager.visibleWindow.bottom + timelineManager.viewportHeight >= timelineManager.totalViewerHeight,
  );

  $effect(() => {
    // we want this to *only* be reactive on `terms`
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    terms;
    untrack(() => handlePromiseError(onSearchQueryUpdate()));
  });

  $effect(() => {
    if (isLoading || !nextPage) {
      return;
    }
    if (timelineManager.assetCount < preloadLimit || isNearTimelineEnd) {
      untrack(() => handlePromiseError(loadNextPage()));
    }
  });

  afterNavigate(({ from }) => {
    // Prevent setting previousRoute to the current page.
    if (from?.url && from.route.id !== page.route.id) {
      previousRoute = from.url.href;
    }
    const route = from?.route?.id;

    if (isPeopleRoute(route)) {
      previousRoute = Route.photos();
    }

    if (isAlbumsRoute(route)) {
      previousRoute = Route.explore();
    }
  });

  const handleSetVisibility = (assetIds: string[]) => {
    assetMultiSelectManager.clear();
    timelineManager.removeAssets(assetIds);
  };

  async function onSearchQueryUpdate() {
    searchGeneration++;
    nextPage = 1;
    searchResultAlbums = [];
    await loadNextPage(true);
  }

  // eslint-disable-next-line svelte/valid-prop-names-in-kit-pages
  export const loadNextPage = async (force?: boolean) => {
    if (!nextPage || (isLoading && !force)) {
      return;
    }
    isLoading = true;
    const generation = searchGeneration;

    const searchDto: SearchTerms = {
      page: nextPage,
      withExif: true,
      ...terms,
    };

    try {
      const { albums, assets } =
        ('query' in searchDto || 'queryAssetId' in searchDto) && smartSearchEnabled
          ? await searchSmart({ smartSearchDto: { ...searchDto, language: $lang } })
          : await searchAssets({ metadataSearchDto: searchDto });

      await timelineManager.initTask.waitUntilExecution();
      if (generation !== searchGeneration) {
        return;
      }

      searchResultAlbums.push(...albums.items);
      timelineManager.upsertAssets(assets.items.map((asset) => toTimelineAsset(asset)));

      nextPage = Number(assets.nextPage) || 0;
    } catch (error) {
      if (generation === searchGeneration) {
        nextPage = 0;
        handleError(error, $t('loading_search_results_failed'));
      }
    } finally {
      if (generation === searchGeneration) {
        isLoading = false;
      }
    }
  };

  function getHumanReadableDate(dateString: string) {
    const date = parseUtcDate(dateString).startOf('day');
    return date.toLocaleString(
      {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      },
      { locale: $locale },
    );
  }

  function getHumanReadableSearchKey(key: keyof SearchTerms): string {
    const keyMap: Partial<Record<keyof SearchTerms, string>> = {
      takenAfter: $t('start_date'),
      takenBefore: $t('end_date'),
      visibility: $t('in_archive'),
      isFavorite: $t('favorite'),
      isNotInAlbum: $t('not_in_any_album'),
      isStacked: $t('stacked'),
      type: $t('media_type'),
      query: $t('context'),
      city: $t('city'),
      country: $t('country'),
      state: $t('state'),
      make: $t('camera_brand'),
      model: $t('camera_model'),
      lensModel: $t('lens_model'),
      personIds: $t('people'),
      tagIds: $t('tags'),
      originalFileName: $t('file_name_text'),
      originalPath: $t('full_path_or_folder'),
      description: $t('description'),
      queryAssetId: $t('query_asset_id'),
      ocr: $t('ocr'),
    };
    return keyMap[key] || key;
  }

  async function getPersonName(personIds: string[]) {
    const personNames = await Promise.all(
      personIds.map(async (personId) => {
        const person = await getPerson({ id: personId });

        if (person.name == '') {
          return $t('no_name');
        }

        return person.name;
      }),
    );

    return personNames.join(', ');
  }

  async function getTagNames(tagIds: string[] | null) {
    if (tagIds === null) {
      return $t('untagged');
    }
    const tagNames = await Promise.all(
      tagIds.map(async (tagId) => {
        const tag = await getTagById({ id: tagId });

        return tag.value;
      }),
    );

    return tagNames.join(', ');
  }

  const onAlbumAddAssets = ({ assetIds }: { assetIds: string[] }) => {
    assetMultiSelectManager.clear();

    if (terms.isNotInAlbum) {
      timelineManager.removeAssets(assetIds);
    }
  };

  function getObjectKeys<T extends object>(obj: T): (keyof T)[] {
    return Object.keys(obj) as (keyof T)[];
  }

  function removeFilter(key: keyof SearchTerms) {
    delete terms[key];
    void goto(Route.search(terms));
  }
</script>

<OnEvents {onAlbumAddAssets} />

<main class="relative z-0 h-dvh overflow-hidden px-2 pt-(--navbar-height) md:px-6 md:pt-(--navbar-height-md)">
  {#key searchQuery}
    <Timeline
      enableRouting={false}
      bind:timelineManager
      options={timelineOptions}
      assetInteraction={assetMultiSelectManager}
      showArchiveIcon
      onEscape={() => assetMultiSelectManager.clear()}
    >
      {#if searchTermKeys.length > 0}
        <section id="search-chips" class="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-8 lg:px-12">
          <div class="flex w-full flex-wrap place-content-center place-items-center gap-2.5 sm:gap-3">
            {#each searchTermKeys as searchKey (searchKey)}
              {@const value = terms[searchKey]}
              <div
                class="inline-flex max-w-full items-center rounded-full bg-primary/10 py-1 ps-1 pe-1 text-xs text-primary ring-1 ring-primary/15 transition-shadow hover:ring-primary/25 dark:bg-immich-dark-primary/15 dark:text-immich-dark-primary dark:ring-immich-dark-primary/20 dark:hover:ring-immich-dark-primary/30"
              >
                <span
                  class="shrink-0 rounded-full bg-primary px-3 py-1.5 font-medium text-light dark:bg-immich-dark-primary dark:text-immich-dark-gray"
                >
                  {getHumanReadableSearchKey(searchKey as keyof SearchTerms)}
                </span>

                {#if value !== true}
                  <span
                    class="max-w-[min(36rem,55vw)] min-w-0 truncate px-3 py-1.5 text-immich-fg dark:text-immich-dark-fg"
                  >
                    {#if (searchKey === 'takenAfter' || searchKey === 'takenBefore') && typeof value === 'string'}
                      {getHumanReadableDate(value)}
                    {:else if searchKey === 'personIds' && Array.isArray(value)}
                      {#await getPersonName(value) then personName}
                        {personName}
                      {/await}
                    {:else if searchKey === 'tagIds' && (Array.isArray(value) || value === null)}
                      {#await getTagNames(value) then tagNames}
                        {tagNames}
                      {/await}
                    {:else if searchKey === 'rating'}
                      {$t('rating_count', { values: { count: value ?? 0 } })}
                    {:else if value === null || value === ''}
                      {$t('unknown')}
                    {:else}
                      {value}
                    {/if}
                  </span>
                {/if}

                <button
                  type="button"
                  class="ms-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-primary outline-offset-2 outline-immich-primary transition-colors hover:bg-primary/15 focus-visible:outline-2 dark:text-immich-dark-primary dark:outline-immich-dark-primary dark:hover:bg-immich-dark-primary/20"
                  aria-label={$t('remove_filter')}
                  title={$t('remove_filter')}
                  onclick={() => removeFilter(searchKey)}
                >
                  <Icon icon={mdiClose} size="14" />
                </button>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if isLoading && timelineManager.assetCount === 0}
        <div class="flex items-center justify-center py-16">
          <LoadingSpinner size="giant" />
        </div>
      {:else if !isLoading && timelineManager.assetCount === 0}
        <div class="flex min-h-[calc(66vh-11rem)] w-full place-content-center items-center dark:text-white">
          <div class="flex flex-col content-center items-center text-center">
            <Icon icon={mdiImageOffOutline} size="3.5em" />
            <p class="mt-5 text-3xl font-medium">{$t('no_results')}</p>
            <p class="text-base font-normal">{$t('no_results_description')}</p>
          </div>
        </div>
      {/if}
    </Timeline>
  {/key}
</main>

<header>
  {#if assetMultiSelectManager.selectionActive}
    <div class="fixed inset-s-0 top-0 z-2 w-full">
      <AssetSelectControlBar>
        {@const Actions = getAssetBulkActions($t)}
        <CommandPaletteDefaultProvider name={$t('assets')} actions={Object.values(Actions)} />

        <CreateSharedLink />
        <SelectAllAssets {timelineManager} assetInteraction={assetMultiSelectManager} />
        <ActionButton action={Actions.AddToAlbum} />
        {#if assetMultiSelectManager.isAllUserOwned}
          <FavoriteAction
            removeFavorite={assetMultiSelectManager.isAllFavorite}
            onFavorite={(ids, isFavorite) => timelineManager.update(ids, (asset) => (asset.isFavorite = isFavorite))}
          />

          <ButtonContextMenu icon={mdiDotsVertical} title={$t('menu')}>
            <ActionMenuItem action={Actions.AddToAlbum} />
            <DownloadAction menuItem />
            <ChangeDate menuItem />
            <ChangeDescription menuItem />
            <ChangeLocation menuItem />
            <ArchiveAction
              menuItem
              unarchive={assetMultiSelectManager.isAllArchived}
              onArchive={(ids, visibility) => timelineManager.update(ids, (asset) => (asset.visibility = visibility))}
            />
            <SetVisibilityAction menuItem onVisibilitySet={handleSetVisibility} />
            {#if authManager.preferences.tags.enabled}
              <TagAction menuItem />
            {/if}
            <DeleteAssets
              menuItem
              onAssetDelete={(assetIds) => timelineManager.removeAssets(assetIds)}
              onUndoDelete={(assets) => timelineManager.upsertAssets(assets)}
            />
            <hr />
            <ActionMenuItem action={Actions.RegenerateThumbnailJob} />
            <ActionMenuItem action={Actions.RefreshMetadataJob} />
            <ActionMenuItem action={Actions.TranscodeVideoJob} />
          </ButtonContextMenu>
        {:else}
          <DownloadAction />
        {/if}
      </AssetSelectControlBar>
    </div>
  {:else}
    <div class="fixed inset-s-0 top-0 z-2 w-full">
      <ControlAppBar onClose={() => goto(previousRoute)} backIcon={mdiArrowLeft}>
        <div class="mx-auto w-full max-w-2xl pe-2">
          <SearchBar grayTheme={false} value={searchDisplayValue} searchQuery={terms} />
        </div>
      </ControlAppBar>
    </div>
  {/if}
</header>
