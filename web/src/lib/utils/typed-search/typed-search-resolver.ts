import {
  AssetTypeEnum,
  getAllTags,
  getSearchSuggestions,
  searchPerson,
  SearchSuggestionType,
  type SmartSearchDto,
  type TagResponseDto,
} from '@immich/sdk';
import { DateTime } from 'luxon';
import { asLocalTimeISO } from '$lib/utils/date-time';
import type {
  TypedSearchIssue,
  TypedSearchParseResult,
  TypedSearchResolutionToken,
  TypedSearchScalarToken,
} from './typed-search-parser';

export type TypedSearchChoice = {
  key: 'person' | 'tag' | 'camera' | 'country' | 'city';
  label: string;
  value: string;
  id?: string;
  field?: 'make' | 'model';
  tokenStart?: number;
  tokenEnd?: number;
};

export type TypedSearchResolveResult =
  | { ok: true; filters: SmartSearchDto }
  | { ok: false; issues: TypedSearchIssue[]; choices: TypedSearchChoice[] };

export function typedSearchChoiceKey(key: 'person' | 'tag' | 'camera', value: string) {
  return `${key}:${value.trim().toLowerCase()}`;
}

export async function resolveTypedSearchFilters(
  parsed: TypedSearchParseResult,
  selectedChoices = new Map<string, TypedSearchChoice>(),
  signal?: AbortSignal,
): Promise<TypedSearchResolveResult> {
  if (parsed.issues.length > 0) {
    return { ok: false, issues: parsed.issues, choices: [] };
  }

  try {
    const filters: SmartSearchDto = {};
    const issues: TypedSearchIssue[] = [];
    const choices: TypedSearchChoice[] = [];
    const personTokens = parsed.resolutionTokens.filter((token) => token.key === 'person');
    const hasTag = parsed.resolutionTokens.some((token) => token.key === 'tag');
    const hasCamera = parsed.resolutionTokens.some((token) => token.key === 'camera');
    const countryToken = parsed.scalarTokens.find((token) => token.key === 'country');
    const cityToken = parsed.scalarTokens.find((token) => token.key === 'city');

    const [people, tags, cameraMakes, cameraModels, countries, cities] = await Promise.all([
      Promise.all(personTokens.map((token) => searchPerson({ name: token.value, withHidden: false }, { signal }))),
      hasTag ? getAllTags({ signal }) : Promise.resolve([] as TagResponseDto[]),
      hasCamera
        ? getSearchSuggestions({ $type: SearchSuggestionType.CameraMake }, { signal })
        : Promise.resolve([] as string[]),
      hasCamera
        ? getSearchSuggestions({ $type: SearchSuggestionType.CameraModel }, { signal })
        : Promise.resolve([] as string[]),
      countryToken
        ? getSearchSuggestions({ $type: SearchSuggestionType.Country }, { signal })
        : Promise.resolve([] as string[]),
      cityToken
        ? getSearchSuggestions(
            {
              $type: SearchSuggestionType.City,
              country: countryToken ? String(countryToken.normalizedValue) : undefined,
            },
            { signal },
          )
        : Promise.resolve([] as string[]),
    ]);

    for (const token of parsed.scalarTokens) {
      applyScalar(filters, token, countries, cities);
    }

    for (const [index, token] of personTokens.entries()) {
      const selected = selectedChoices.get(typedSearchChoiceKey('person', token.value));
      if (selected?.id) {
        filters.personIds = [...(filters.personIds ?? []), selected.id];
        continue;
      }

      resolveEntityToken(
        token,
        people[index],
        (person) => person.name,
        (person) => ({
          key: 'person',
          id: person.id,
          label: person.name,
          value: token.value,
          tokenStart: token.start,
          tokenEnd: token.end,
        }),
        (choice) => {
          filters.personIds = [...(filters.personIds ?? []), choice.id!];
        },
        issues,
        choices,
      );
    }

    for (const token of parsed.resolutionTokens.filter((token) => token.key === 'tag')) {
      const selected = selectedChoices.get(typedSearchChoiceKey('tag', token.value));
      if (selected?.id) {
        filters.tagIds = [...(filters.tagIds ?? []), selected.id];
        continue;
      }

      resolveEntityToken(
        token,
        tags,
        (tag) => tag.value,
        (tag) => ({
          key: 'tag',
          id: tag.id,
          label: tag.value,
          value: token.value,
          tokenStart: token.start,
          tokenEnd: token.end,
        }),
        (choice) => {
          filters.tagIds = [...(filters.tagIds ?? []), choice.id!];
        },
        issues,
        choices,
      );
    }

    for (const token of parsed.resolutionTokens.filter((token) => token.key === 'camera')) {
      const selected = selectedChoices.get(typedSearchChoiceKey('camera', token.value));
      if (selected?.field) {
        filters[selected.field] = selected.label;
        continue;
      }

      const matches = bestMatches(
        [
          ...cameraMakes.map((label) => ({
            key: 'camera' as const,
            field: 'make' as const,
            label,
            value: token.value,
            tokenStart: token.start,
            tokenEnd: token.end,
          })),
          ...cameraModels.map((label) => ({
            key: 'camera' as const,
            field: 'model' as const,
            label,
            value: token.value,
            tokenStart: token.start,
            tokenEnd: token.end,
          })),
        ],
        (choice) => choice.label,
        token.value,
      );
      if (matches.length === 1) {
        filters[matches[0].field!] = matches[0].label;
      } else {
        addResolutionIssue(token, matches, issues, choices);
      }
    }

    return issues.length > 0 ? { ok: false, issues, choices } : { ok: true, filters };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    return {
      ok: false,
      issues: [
        {
          code: 'resolver-error',
          raw: parsed.raw,
          message: error instanceof Error ? error.message : 'Unable to resolve search filters',
        },
      ],
      choices: [],
    };
  }
}

function resolveEntityToken<T>(
  token: TypedSearchResolutionToken,
  candidates: T[],
  getLabel: (candidate: T) => string,
  asChoice: (candidate: T) => TypedSearchChoice,
  apply: (choice: TypedSearchChoice) => void,
  issues: TypedSearchIssue[],
  choices: TypedSearchChoice[],
) {
  const matches = bestMatches(candidates, getLabel, token.value).map((candidate) => asChoice(candidate));
  if (matches.length === 1) {
    apply(matches[0]);
    return;
  }
  addResolutionIssue(token, matches, issues, choices);
}

function addResolutionIssue(
  token: TypedSearchResolutionToken,
  matches: TypedSearchChoice[],
  issues: TypedSearchIssue[],
  choices: TypedSearchChoice[],
) {
  issues.push({
    code: matches.length === 0 ? 'no-match' : 'ambiguous',
    key: token.key,
    raw: token.raw,
    value: token.value,
    message:
      matches.length === 0
        ? `No ${token.key} found for "${token.value}"`
        : `Choose a ${token.key} for "${token.value}"`,
  });
  choices.push(...matches);
}

function bestMatches<T>(candidates: T[], getLabel: (candidate: T) => string, value: string) {
  const normalized = value.toLowerCase();
  const exact = candidates.filter((candidate) => getLabel(candidate).toLowerCase() === normalized);
  return exact.length > 0
    ? exact
    : candidates.filter((candidate) => getLabel(candidate).toLowerCase().includes(normalized));
}

function canonicalExact(candidates: string[], value: string) {
  return candidates.find((candidate) => candidate.toLowerCase() === value.toLowerCase()) ?? value;
}

function applyScalar(filters: SmartSearchDto, token: TypedSearchScalarToken, countries: string[], cities: string[]) {
  switch (token.key) {
    case 'from': {
      const date = DateTime.fromISO(String(token.normalizedValue)).startOf('day') as DateTime<true>;
      filters.takenAfter = asLocalTimeISO(date);
      return;
    }
    case 'to': {
      const date = DateTime.fromISO(String(token.normalizedValue)).endOf('day') as DateTime<true>;
      filters.takenBefore = asLocalTimeISO(date);
      return;
    }
    case 'city': {
      filters.city = canonicalExact(cities, String(token.normalizedValue));
      return;
    }
    case 'country': {
      filters.country = canonicalExact(countries, String(token.normalizedValue));
      return;
    }
    case 'type': {
      filters.type = token.normalizedValue === 'image' ? AssetTypeEnum.Image : AssetTypeEnum.Video;
      return;
    }
    case 'favorite': {
      filters.isFavorite = Boolean(token.normalizedValue);
      return;
    }
    case 'rating': {
      filters.rating = Number(token.normalizedValue);
      return;
    }
  }
}
