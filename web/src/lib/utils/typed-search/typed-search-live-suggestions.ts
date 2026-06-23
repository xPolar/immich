import {
  getAllPeople,
  getAllTags,
  getSearchSuggestions,
  searchPerson,
  SearchSuggestionType,
  type PersonResponseDto,
  type TagResponseDto,
} from '@immich/sdk';
import type { TypedSearchParseResult, TypedSearchTokenSpan } from './typed-search-parser';

export type LiveTypedSearchKey = 'person' | 'tag' | 'country' | 'city';

export type LiveTypedSearchToken = TypedSearchTokenSpan & { key: LiveTypedSearchKey };

export type LiveTypedSearchPreview =
  | { kind: 'person'; data: PersonResponseDto }
  | { kind: 'tag'; data: TagResponseDto };

export type LiveTypedSearchChoice = {
  id: string;
  key: LiveTypedSearchKey;
  label: string;
  value: string;
  tokenStart: number;
  tokenEnd: number;
  entityId?: string;
  secondaryLabel?: string;
  preview?: LiveTypedSearchPreview;
};

export type LiveTypedSearchStatus =
  | { status: 'idle' }
  | { status: 'loading'; key: LiveTypedSearchKey }
  | { status: 'ok'; key: LiveTypedSearchKey; items: LiveTypedSearchChoice[]; total: number }
  | { status: 'empty'; key: LiveTypedSearchKey }
  | { status: 'timeout'; key: LiveTypedSearchKey }
  | { status: 'error'; key: LiveTypedSearchKey; message: string };

export type LiveTypedSearchContext = {
  parsed: TypedSearchParseResult;
  activeToken?: TypedSearchTokenSpan;
  signal?: AbortSignal;
};

const liveResultLimit = 5;

export function isLiveTypedSearchToken(token: TypedSearchTokenSpan | undefined): token is LiveTypedSearchToken {
  return token?.key === 'person' || token?.key === 'tag' || token?.key === 'country' || token?.key === 'city';
}

export function liveTypedSearchChoiceValue(choice: LiveTypedSearchChoice) {
  return `filter:${choice.id}:${choice.label}`;
}

function makeChoiceId(token: TypedSearchTokenSpan, entityId: string, key: LiveTypedSearchKey) {
  return `${key}:${token.start}:${token.end}:${entityId}`;
}

function personChoice(token: TypedSearchTokenSpan, person: PersonResponseDto): LiveTypedSearchChoice {
  return {
    id: makeChoiceId(token, person.id, 'person'),
    key: 'person',
    label: person.name,
    value: person.name,
    tokenStart: token.start,
    tokenEnd: token.end,
    entityId: person.id,
    preview: { kind: 'person', data: person },
  };
}

function tagChoice(token: TypedSearchTokenSpan, tag: TagResponseDto): LiveTypedSearchChoice {
  return {
    id: makeChoiceId(token, tag.id, 'tag'),
    key: 'tag',
    label: tag.value,
    value: tag.value,
    tokenStart: token.start,
    tokenEnd: token.end,
    entityId: tag.id,
    preview: { kind: 'tag', data: tag },
  };
}

function stringChoice(
  token: TypedSearchTokenSpan,
  key: 'country' | 'city',
  value: string,
  secondaryLabel?: string,
): LiveTypedSearchChoice {
  return {
    id: makeChoiceId(token, value, key),
    key,
    label: value,
    value,
    tokenStart: token.start,
    tokenEnd: token.end,
    secondaryLabel,
  };
}

export async function resolveLiveTypedSearchSuggestions(
  context: LiveTypedSearchContext,
): Promise<LiveTypedSearchStatus> {
  const token = context.activeToken;
  if (!token || !isLiveTypedSearchToken(token)) {
    return { status: 'idle' };
  }

  switch (token.key) {
    case 'person': {
      return resolvePersonLiveSuggestions(token, context.signal);
    }
    case 'tag': {
      return resolveTagLiveSuggestions(token, context.signal);
    }
    case 'country': {
      return resolveCountryLiveSuggestions(token, context.signal);
    }
    case 'city': {
      return resolveCityLiveSuggestions(context, token);
    }
  }
}

async function resolvePersonLiveSuggestions(
  token: TypedSearchTokenSpan,
  signal?: AbortSignal,
): Promise<LiveTypedSearchStatus> {
  try {
    const value = token.value.trim();
    let people: PersonResponseDto[];
    if (value) {
      people = await searchPerson({ name: value, withHidden: false }, { signal });
    } else {
      const response = await getAllPeople({ size: 100, withHidden: false }, { signal });
      people = response.people;
    }
    const normalizedValue = value.toLowerCase();
    const matches = people
      .filter((person) => person.name)
      .filter((person) => !normalizedValue || person.name.toLowerCase().includes(normalizedValue))
      .slice(0, liveResultLimit)
      .map((person) => personChoice(token, person));

    return matches.length === 0
      ? { status: 'empty', key: 'person' }
      : { status: 'ok', key: 'person', items: matches, total: matches.length };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return {
      status: 'error',
      key: 'person',
      message: error instanceof Error ? error.message : 'Unable to load people',
    };
  }
}

async function resolveTagLiveSuggestions(
  token: TypedSearchTokenSpan,
  signal?: AbortSignal,
): Promise<LiveTypedSearchStatus> {
  try {
    const value = token.value.trim().toLowerCase();
    const tags = await getAllTags({ signal });
    const matches = tags
      .filter((tag) => !value || tag.value.toLowerCase().includes(value))
      .slice(0, liveResultLimit)
      .map((tag) => tagChoice(token, tag));

    return matches.length === 0
      ? { status: 'empty', key: 'tag' }
      : { status: 'ok', key: 'tag', items: matches, total: matches.length };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return {
      status: 'error',
      key: 'tag',
      message: error instanceof Error ? error.message : 'Unable to load tags',
    };
  }
}

async function resolveCountryLiveSuggestions(
  token: TypedSearchTokenSpan,
  signal?: AbortSignal,
): Promise<LiveTypedSearchStatus> {
  try {
    const value = token.value.trim().toLowerCase();
    const countries = await getSearchSuggestions({ $type: SearchSuggestionType.Country }, { signal });
    const matches = countries
      .filter(isString)
      .filter((country) => !value || country.toLowerCase().includes(value))
      .slice(0, liveResultLimit)
      .map((country) => stringChoice(token, 'country', country));

    return matches.length === 0
      ? { status: 'empty', key: 'country' }
      : { status: 'ok', key: 'country', items: matches, total: matches.length };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return {
      status: 'error',
      key: 'country',
      message: error instanceof Error ? error.message : 'Unable to load countries',
    };
  }
}

async function getCanonicalCountryForCity(context: LiveTypedSearchContext) {
  const countryToken = context.parsed.scalarTokens.find((token) => token.key === 'country');
  if (!countryToken) {
    return undefined;
  }

  const value = String(countryToken.normalizedValue);
  const countries = await getSearchSuggestions({ $type: SearchSuggestionType.Country }, { signal: context.signal });
  return canonicalExactMatch(countries.filter(isString), value);
}

async function resolveCityLiveSuggestions(
  context: LiveTypedSearchContext,
  token: TypedSearchTokenSpan,
): Promise<LiveTypedSearchStatus> {
  try {
    const value = token.value.trim();
    const country = await getCanonicalCountryForCity(context);
    const cities = await getSearchSuggestions(
      { $type: SearchSuggestionType.City, ...(country ? { country } : {}) },
      { signal: context.signal },
    );
    const normalizedValue = value.toLowerCase();
    const matches = cities
      .filter(isString)
      .filter((city) => !normalizedValue || city.toLowerCase().includes(normalizedValue))
      .slice(0, liveResultLimit)
      .map((city) => stringChoice(token, 'city', city, country));

    return matches.length === 0
      ? { status: 'empty', key: 'city' }
      : { status: 'ok', key: 'city', items: matches, total: matches.length };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return {
      status: 'error',
      key: 'city',
      message: error instanceof Error ? error.message : 'Unable to load cities',
    };
  }
}

function canonicalExactMatch(candidates: string[], value: string) {
  return candidates.find((candidate) => candidate.toLowerCase() === value.toLowerCase()) ?? value;
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}
