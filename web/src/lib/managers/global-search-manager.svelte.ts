import {
  getAllAlbums,
  getAllPeople,
  getAllTags,
  searchAssets,
  searchPerson,
  searchPlaces,
  searchSmart,
  type AlbumResponseDto,
  type AssetResponseDto,
  type PersonResponseDto,
  type PlacesResponseDto,
  type SmartSearchDto,
  type TagResponseDto,
} from '@immich/sdk';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
import { Route } from '$lib/route';
import {
  addGlobalSearchRecent,
  getGlobalSearchRecents,
  removeGlobalSearchRecent,
  type GlobalSearchRecent,
} from '$lib/stores/cmdk-recent';
import { storeTypedSearchDisplayText } from '$lib/utils/typed-search/typed-search-display-cache';
import {
  isLiveTypedSearchToken,
  resolveLiveTypedSearchSuggestions,
  type LiveTypedSearchChoice,
  type LiveTypedSearchStatus,
} from '$lib/utils/typed-search/typed-search-live-suggestions';
import {
  getActiveTypedSearchToken,
  parseTypedSearch,
  rewriteTypedSearchToken,
  type TypedSearchIssue,
} from '$lib/utils/typed-search/typed-search-parser';
import { resolveTypedSearchFilters } from '$lib/utils/typed-search/typed-search-resolver';
import { compareGlobalSearchPeople, parseGlobalSearchScope, type GlobalSearchScope } from './cmdk-prefix';
import { COMMAND_ITEMS, isAlmostExactCommandMatch, type CommandItem } from './command-items';
import { isAlmostExactNavigationMatch, NAVIGATION_ITEMS, type NavigationItem } from './navigation-items';

export type GlobalSearchMode = 'smart' | 'metadata' | 'description' | 'ocr';
export type GlobalSearchPresentation = 'dropdown' | 'modal';
export type GlobalSearchStatus<T> =
  | { status: 'idle' | 'loading' | 'empty' | 'timeout' }
  | { status: 'error'; message: string }
  | { status: 'ok'; items: T[]; total: number };

export type GlobalSearchResult =
  | { id: string; kind: 'photo'; item: AssetResponseDto }
  | { id: string; kind: 'album'; item: AlbumResponseDto }
  | { id: string; kind: 'person'; item: PersonResponseDto }
  | { id: string; kind: 'place'; item: PlacesResponseDto }
  | { id: string; kind: 'tag'; item: TagResponseDto }
  | { id: string; kind: 'command'; item: CommandItem }
  | { id: string; kind: 'navigation'; item: NavigationItem }
  | { id: string; kind: 'search'; query: string }
  | { id: string; kind: 'recent'; item: GlobalSearchRecent }
  | { id: string; kind: 'typed'; item: LiveTypedSearchChoice };

const idle = { status: 'idle' as const };
const modes: GlobalSearchMode[] = ['smart', 'metadata', 'description', 'ocr'];
const providerTimeout = 15_000;

function loadMode(): GlobalSearchMode {
  if (!browser) {
    return 'smart';
  }
  const stored = localStorage.getItem('searchQueryType');
  return modes.includes(stored as GlobalSearchMode) ? (stored as GlobalSearchMode) : 'smart';
}

export class GlobalSearchManager {
  isOpen = $state(false);
  presentation = $state<GlobalSearchPresentation>('modal');
  query = $state('');
  mode = $state<GlobalSearchMode>(loadMode());
  scope = $state<GlobalSearchScope>('all');
  activeIndex = $state(0);
  caret = $state(0);
  sections = $state({
    photos: idle as GlobalSearchStatus<AssetResponseDto>,
    albums: idle as GlobalSearchStatus<AlbumResponseDto>,
    people: idle as GlobalSearchStatus<PersonResponseDto>,
    places: idle as GlobalSearchStatus<PlacesResponseDto>,
    tags: idle as GlobalSearchStatus<TagResponseDto>,
    commands: idle as GlobalSearchStatus<CommandItem>,
    navigation: idle as GlobalSearchStatus<NavigationItem>,
  });
  typedSuggestions = $state<LiveTypedSearchStatus>({ status: 'idle' });
  typedIssues = $state<TypedSearchIssue[]>([]);
  typedChoices = $state<LiveTypedSearchChoice[]>([]);
  typedPlainQuery = $state('');
  typedFilters = $state<SmartSearchDto>({});
  recents = $state<GlobalSearchRecent[]>([]);
  pendingProviders = $state<string[]>([]);
  providerErrors = $state<Record<string, string>>({});
  smartSearchUnavailable = $state(false);
  loading = $derived(this.pendingProviders.length > 0);
  results = $derived.by(() => this.buildResults());
  activeResult = $derived(this.results[this.activeIndex]);
  private debounce?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private restoreFocus?: HTMLElement;

  open(presentation: GlobalSearchPresentation = 'modal', trigger?: HTMLElement, initialQuery = '') {
    this.restoreFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
    this.presentation = presentation;
    this.isOpen = true;
    this.query = initialQuery;
    this.scope = 'all';
    this.resetEntitySections();
    this.runSynchronousProviders('');
    this.recents = getGlobalSearchRecents();
    this.activeIndex = 0;
  }

  close(restoreFocus = this.presentation === 'modal') {
    this.isOpen = false;
    this.controller?.abort();
    clearTimeout(this.debounce);
    this.pendingProviders = [];
    this.query = '';
    this.typedSuggestions = { status: 'idle' };
    this.typedIssues = [];
    this.typedChoices = [];
    if (restoreFocus) {
      const target = this.restoreFocus;
      queueMicrotask(() => target?.focus());
    }
  }

  toggle(presentation: GlobalSearchPresentation = 'modal', trigger?: HTMLElement) {
    if (this.isOpen && this.presentation === presentation) {
      this.close();
    } else {
      this.open(presentation, trigger);
    }
  }

  setQuery(value: string, caret = value.length) {
    this.query = value;
    this.caret = caret;
    const parsedScope = parseGlobalSearchScope(value);
    this.scope = parsedScope.scope;
    this.activeIndex = 0;
    this.runSynchronousProviders(parsedScope.query);
    this.controller?.abort();
    clearTimeout(this.debounce);
    if (!parsedScope.query && parsedScope.scope === 'all') {
      this.resetEntitySections();
      this.typedSuggestions = { status: 'idle' };
      return;
    }
    this.markPending(parsedScope.scope);
    this.debounce = setTimeout(() => void this.runProviders(parsedScope.query, parsedScope.scope), 150);
  }

  cycleMode() {
    this.setMode(modes[(modes.indexOf(this.mode) + 1) % modes.length]);
  }

  setMode(mode: GlobalSearchMode) {
    if (this.scope !== 'all' || this.mode === mode) {
      return;
    }
    this.mode = mode;
    if (browser) {
      localStorage.setItem('searchQueryType', mode);
    }
    this.smartSearchUnavailable = false;
    this.setQuery(this.query, this.caret);
  }

  removeRecent(id: string) {
    removeGlobalSearchRecent(id);
    this.recents = getGlobalSearchRecents();
  }

  move(delta: number) {
    if (this.results.length > 0) {
      this.activeIndex = (this.activeIndex + delta + this.results.length) % this.results.length;
    }
  }

  moveTo(position: 'start' | 'end') {
    this.activeIndex = position === 'start' ? 0 : Math.max(0, this.results.length - 1);
  }

  async activate(result = this.activeResult) {
    if (!result) {
      return;
    }
    if (result.kind === 'typed') {
      const parsed = parseTypedSearch(this.query);
      const token = getActiveTypedSearchToken(parsed, this.caret);
      if (token) {
        const rewritten = rewriteTypedSearchToken(this.query, token, {
          key: result.item.key,
          value: result.item.value,
        });
        this.setQuery(`${rewritten.text} `, rewritten.caret + 1);
      }
      return;
    }
    if (result.kind === 'recent') {
      if (result.item.kind === 'query') {
        await this.activateSearch(result.item.value);
      } else {
        await goto(result.item.value);
        this.close();
      }
      return;
    }
    if (result.kind === 'command') {
      this.close();
      await result.item.run();
      return;
    }
    if (result.kind === 'navigation') {
      this.rememberNavigation(result.item);
      await goto(result.item.route);
      this.close();
      return;
    }
    switch (result.kind) {
      case 'photo': {
        const destination = Route.viewAsset({ id: result.item.id });
        this.rememberDestination(result.id, result.item.originalFileName, destination);
        await goto(destination);

        break;
      }
      case 'album': {
        const destination = Route.viewAlbum({ id: result.item.id });
        this.rememberDestination(result.id, result.item.albumName, destination);
        await goto(destination);

        break;
      }
      case 'person': {
        const destination = Route.viewPerson({ id: result.item.id });
        this.rememberDestination(result.id, result.item.name, destination);
        await goto(destination);

        break;
      }
      case 'place': {
        const destination = Route.map({ zoom: 12, lat: result.item.latitude, lng: result.item.longitude });
        this.rememberDestination(result.id, result.item.name, destination);
        await goto(destination);

        break;
      }
      case 'tag': {
        const destination = Route.tags({ path: result.item.value });
        this.rememberDestination(result.id, result.item.value, destination);
        await goto(destination);

        break;
      }
      default: {
        await this.activateSearch(result.query);
        return;
      }
    }
    this.close();
  }

  async activateSearch(query = this.query.trim()) {
    if (!query) {
      return;
    }
    const parsed = parseTypedSearch(query);
    this.typedPlainQuery = parsed.queryText;
    if (parsed.issues.length > 0) {
      this.typedIssues = parsed.issues;
      this.typedChoices = [];
      return;
    }
    const resolved = await resolveTypedSearchFilters(parsed);
    if (!resolved.ok) {
      this.typedIssues = resolved.issues;
      this.typedChoices = resolved.choices
        .filter((choice) => choice.key === 'person' || choice.key === 'tag')
        .map((choice) => ({
          id: `resolve:${choice.tokenIdentity}:${choice.id ?? choice.value}`,
          key: choice.key as 'person' | 'tag',
          label: choice.label,
          value: choice.value,
          tokenStart: 0,
          tokenEnd: query.length,
          entityId: choice.id,
        }));
      return;
    }
    this.typedIssues = [];
    this.typedChoices = [];
    const dto = { ...resolved.filters, query: resolved.queryText || undefined };
    const destination = Route.search(dto);
    storeTypedSearchDisplayText(destination, query);
    addGlobalSearchRecent({ id: `query:${query.toLocaleLowerCase()}`, kind: 'query', label: query, value: query });
    await goto(destination);
    this.close();
  }

  private rememberNavigation(item: NavigationItem) {
    addGlobalSearchRecent({
      id: item.id,
      kind: 'destination',
      label: get(t)(item.labelKey as never),
      value: item.route,
    });
  }

  private rememberDestination(id: string, label: string, value: string) {
    addGlobalSearchRecent({ id, kind: 'destination', label, value });
  }

  private runSynchronousProviders(query: string) {
    const translate = get(t);
    const visibleNavigation = NAVIGATION_ITEMS.filter(
      (item) =>
        (!item.adminOnly || authManager.user.isAdmin) &&
        (!item.featureFlag || featureFlagsManager.value[item.featureFlag]),
    );
    const matches = <T extends { labelKey: string }>(items: readonly T[]) =>
      items
        .map((item) => ({ item, score: this.score(query, translate(item.labelKey as never)) }))
        .filter(({ score }) => score > 0 || !query)
        .sort((a, b) => b.score - a.score)
        .map(({ item }) => item);
    const commands = matches(COMMAND_ITEMS);
    const navigation = matches(visibleNavigation);
    const bareCatalog = this.scope === 'commands' && query === '';
    if (bareCatalog) {
      const byLabel = (a: { labelKey: string }, b: { labelKey: string }) =>
        translate(a.labelKey as never).localeCompare(translate(b.labelKey as never));
      commands.sort(byLabel);
      navigation.sort(byLabel);
    }
    this.sections.commands =
      commands.length > 0
        ? { status: 'ok', items: bareCatalog ? commands : commands.slice(0, 5), total: commands.length }
        : { status: 'empty' };
    this.sections.navigation =
      navigation.length > 0
        ? { status: 'ok', items: bareCatalog ? navigation : navigation.slice(0, 5), total: navigation.length }
        : { status: 'empty' };
  }

  private score(query: string, label: string) {
    if (!query) {
      return 1;
    }
    const normalizedLabel = label.toLocaleLowerCase();
    const normalizedQuery = query.toLocaleLowerCase();
    return normalizedLabel === normalizedQuery
      ? 3
      : normalizedLabel.startsWith(normalizedQuery)
        ? 2
        : normalizedLabel.includes(normalizedQuery)
          ? 1
          : 0;
  }

  private markPending(scope: GlobalSearchScope) {
    const keys =
      scope === 'all'
        ? (['photos', 'albums', 'people', 'places', 'tags'] as const)
        : scope === 'people'
          ? (['people'] as const)
          : scope === 'tags'
            ? (['tags'] as const)
            : scope === 'albums'
              ? (['albums'] as const)
              : [];
    this.pendingProviders = [...keys, 'typed'];
    this.providerErrors = {};
  }

  private resetEntitySections() {
    this.sections.photos = idle;
    this.sections.albums = idle;
    this.sections.people = idle;
    this.sections.places = idle;
    this.sections.tags = idle;
  }

  private async runProviders(query: string, scope: GlobalSearchScope) {
    const controller = new AbortController();
    this.controller = controller;
    const tasks: Promise<void>[] = [];
    switch (scope) {
      case 'all': {
        tasks.push(
          this.runProvider('photos', controller, (signal) => this.runPhotos(query, signal)),
          this.runProvider('albums', controller, (signal) => this.runAlbums(query, signal)),
          this.runProvider('people', controller, (signal) => this.runPeople(query, signal)),
          this.runProvider('places', controller, (signal) => this.runPlaces(query, signal)),
          this.runProvider('tags', controller, (signal) => this.runTags(query, signal)),
        );

        break;
      }
      case 'people': {
        tasks.push(this.runProvider('people', controller, (signal) => this.runPeople(query, signal)));

        break;
      }
      case 'tags': {
        tasks.push(this.runProvider('tags', controller, (signal) => this.runTags(query, signal)));

        break;
      }
      case 'albums': {
        tasks.push(this.runProvider('albums', controller, (signal) => this.runAlbums(query, signal)));

        break;
      }
      // No default
    }
    tasks.push(this.runProvider('typed', controller, (signal) => this.runTypedSuggestions(signal)));
    await Promise.allSettled(tasks);
  }

  private async runProvider(name: string, controller: AbortController, run: (signal: AbortSignal) => Promise<void>) {
    const timeoutController = new AbortController();
    const signal = AbortSignal.any([controller.signal, timeoutController.signal]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        run(signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timeoutController.abort();
            reject(new DOMException('Search is taking too long', 'TimeoutError'));
          }, providerTimeout);
        }),
      ]);
    } catch (error) {
      if (!controller.signal.aborted && this.controller === controller) {
        this.providerErrors[name] =
          error instanceof DOMException && error.name === 'TimeoutError'
            ? 'Search is taking too long'
            : error instanceof Error
              ? error.message
              : 'Unable to load results';
      }
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) {
        this.pendingProviders = this.pendingProviders.filter((provider) => provider !== name);
      }
    }
  }

  private async runPhotos(query: string, signal: AbortSignal) {
    if (!query) {
      this.sections.photos = { status: 'empty' };
      return;
    }
    try {
      const parsed = parseTypedSearch(this.query);
      this.typedPlainQuery = parsed.queryText;
      if (parsed.issues.length > 0) {
        this.typedIssues = parsed.issues;
        return;
      }
      const resolved = await resolveTypedSearchFilters(parsed, { signal });
      if (!resolved.ok) {
        this.typedIssues = resolved.issues;
        return;
      }
      this.typedIssues = [];
      this.typedFilters = resolved.filters;
      const plainQuery = resolved.queryText.trim();
      const filterOnly = !plainQuery && Object.keys(resolved.filters).length > 0;
      const response =
        this.mode === 'smart' && !filterOnly
          ? await searchSmart({ smartSearchDto: { ...resolved.filters, query: plainQuery, size: 5 } }, { signal })
          : await searchAssets(
              {
                metadataSearchDto: {
                  ...resolved.filters,
                  size: 5,
                  ...(this.mode === 'metadata' ? { originalFileName: plainQuery } : {}),
                  ...(this.mode === 'description' ? { description: plainQuery } : {}),
                  ...(this.mode === 'ocr' ? { ocr: plainQuery } : {}),
                },
              },
              { signal },
            );
      this.settled('photos', response.assets.items.slice(0, 5), response.assets.total);
    } catch (error) {
      if (this.mode === 'smart' && !signal.aborted) {
        this.smartSearchUnavailable = true;
        this.providerErrors.photos = 'Smart search is unavailable';
        return;
      }
      this.failed('photos', error);
    }
  }

  private async runAlbums(query: string, signal: AbortSignal) {
    try {
      const albums = await getAllAlbums({}, { signal });
      const matches = albums.filter(
        ({ albumName }) => !query || albumName.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      );
      this.settled('albums', matches.slice(0, 5), matches.length);
    } catch (error) {
      this.failed('albums', error);
    }
  }

  private async runPeople(query: string, signal: AbortSignal) {
    try {
      let people: PersonResponseDto[];
      if (query) {
        people = await searchPerson({ name: query, withHidden: false }, { signal });
      } else {
        const response = await getAllPeople({ size: 100, withHidden: false }, { signal });
        people = response.people;
      }
      const matches = [...people].sort(compareGlobalSearchPeople);
      this.settled('people', matches.slice(0, query ? 5 : 10), matches.length);
    } catch (error) {
      this.failed('people', error);
    }
  }

  private async runPlaces(query: string, signal: AbortSignal) {
    if (!query) {
      this.sections.places = { status: 'empty' };
      return;
    }
    try {
      const places = await searchPlaces({ name: query }, { signal });
      this.settled('places', places.slice(0, 3), places.length);
    } catch (error) {
      this.failed('places', error);
    }
  }

  private async runTags(query: string, signal: AbortSignal) {
    try {
      const tags = await getAllTags({ signal });
      const matches = tags.filter(
        ({ value }) => !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      );
      this.settled('tags', matches.slice(0, 5), matches.length);
    } catch (error) {
      this.failed('tags', error);
    }
  }

  private async runTypedSuggestions(signal: AbortSignal) {
    const parsed = parseTypedSearch(this.query);
    const token = getActiveTypedSearchToken(parsed, this.caret);
    if (!isLiveTypedSearchToken(token)) {
      this.typedSuggestions = { status: 'idle' };
      return;
    }
    this.typedSuggestions = { status: 'loading', key: token.key };
    try {
      this.typedSuggestions = await resolveLiveTypedSearchSuggestions({ parsed, activeToken: token, signal });
    } catch (error) {
      if (!signal.aborted) {
        this.typedSuggestions = {
          status: 'error',
          key: token.key,
          message: error instanceof Error ? error.message : 'Unable to load suggestions',
        };
      }
    }
  }

  private settled<K extends 'photos' | 'albums' | 'people' | 'places' | 'tags'>(
    key: K,
    items: Extract<(typeof this.sections)[K], { status: 'ok' }>['items'],
    total: number,
  ) {
    this.sections[key] = (items.length > 0 ? { status: 'ok', items, total } : { status: 'empty' }) as never;
    delete this.providerErrors[key];
  }

  private failed(key: 'photos' | 'albums' | 'people' | 'places' | 'tags', error: unknown, fallback?: string) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      this.providerErrors[key] = 'Search is taking too long';
      if (this.sections[key].status !== 'ok') {
        this.sections[key] = { status: 'timeout' } as never;
      }
      return;
    }
    this.providerErrors[key] = fallback ?? (error instanceof Error ? error.message : 'Unable to load results');
    if (this.sections[key].status === 'ok') {
      return;
    }
    this.sections[key] = {
      status: 'error',
      message: fallback ?? (error instanceof Error ? error.message : 'Unable to load results'),
    } as never;
  }

  private buildResults(): GlobalSearchResult[] {
    if (!this.query.trim()) {
      if (this.recents.length > 0) {
        return this.recents.map((item) => ({ id: `recent:${item.id}`, kind: 'recent', item }));
      }
      return this.visibleNavigation()
        .filter(({ category }) => category === 'user')
        .map((item) => ({ id: item.id, kind: 'navigation' as const, item }));
    }
    const results: GlobalSearchResult[] = [];
    if (this.typedChoices.length > 0) {
      results.push(...this.typedChoices.map((item) => ({ id: `choice:${item.id}`, kind: 'typed' as const, item })));
    }
    if (this.typedSuggestions.status === 'ok') {
      results.push(
        ...this.typedSuggestions.items.map((item) => ({ id: `typed:${item.id}`, kind: 'typed' as const, item })),
      );
    }
    const translate = get(t);
    const payload = parseGlobalSearchScope(this.query).query;
    if (this.scope === 'all') {
      const promotedCommand =
        this.sections.commands.status === 'ok'
          ? this.sections.commands.items.find((item) =>
              isAlmostExactCommandMatch(payload, translate(item.labelKey as never)),
            )
          : undefined;
      const promotedNavigation =
        this.sections.navigation.status === 'ok'
          ? this.sections.navigation.items.find((item) =>
              isAlmostExactNavigationMatch(payload, translate(item.labelKey as never)),
            )
          : undefined;
      if (promotedCommand) {
        results.push({ id: promotedCommand.id, kind: 'command', item: promotedCommand });
      } else if (promotedNavigation) {
        results.push({ id: promotedNavigation.id, kind: 'navigation', item: promotedNavigation });
      } else {
        results.push({ id: 'top-search', kind: 'search', query: this.query.trim() });
      }
    }
    const append = <K extends 'photos' | 'albums' | 'people' | 'places' | 'tags'>(
      key: K,
      kind: K extends 'photos'
        ? 'photo'
        : K extends 'albums'
          ? 'album'
          : K extends 'people'
            ? 'person'
            : K extends 'places'
              ? 'place'
              : 'tag',
    ) => {
      const section = this.sections[key];
      if (section.status === 'ok') {
        for (const item of section.items) {
          results.push({
            id: `${kind}:${'id' in item ? item.id : `${item.latitude}:${item.longitude}`}`,
            kind,
            item,
          } as GlobalSearchResult);
        }
      }
    };
    switch (this.scope) {
      case 'all': {
        append('photos', 'photo');
        append('albums', 'album');
        append('people', 'person');
        append('places', 'place');
        append('tags', 'tag');

        break;
      }
      case 'people': {
        append('people', 'person');

        break;
      }
      case 'tags': {
        append('tags', 'tag');

        break;
      }
      case 'albums': {
        append('albums', 'album');

        break;
      }
      // No default
    }
    if (this.scope === 'all' || this.scope === 'commands') {
      if (this.sections.commands.status === 'ok') {
        results.push(
          ...this.sections.commands.items
            .filter((item) => !results.some(({ id }) => id === item.id))
            .map((item) => ({ id: item.id, kind: 'command' as const, item })),
        );
      }
      if (this.sections.navigation.status === 'ok') {
        results.push(
          ...this.sections.navigation.items
            .filter((item) => !results.some(({ id }) => id === item.id))
            .map((item) => ({ id: item.id, kind: 'navigation' as const, item })),
        );
      }
    }
    return results;
  }

  private visibleNavigation() {
    return NAVIGATION_ITEMS.filter(
      (item) =>
        (!item.adminOnly || authManager.user.isAdmin) &&
        (!item.featureFlag || featureFlagsManager.value[item.featureFlag]),
    );
  }
}

export const globalSearchManager = new GlobalSearchManager();
