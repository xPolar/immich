import {
  AssetTypeEnum,
  getAllTags,
  getSearchSuggestions,
  searchPerson,
  SearchSuggestionType,
  type PersonResponseDto,
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
  TypedSearchStableTokenIdentity,
} from './typed-search-parser';

export type TypedSearchChoice = {
  tokenRaw: string;
  key: 'person' | 'tag' | 'camera';
  id?: string;
  label: string;
  value: string;
  field?: 'make' | 'model';
  tokenIdentity: TypedSearchStableTokenIdentity;
};

export type TypedSearchResolveContext = {
  signal?: AbortSignal;
  selectedChoices?: Map<string, TypedSearchChoice>;
};

export type TypedSearchResolveResult =
  | {
      ok: true;
      queryText: string;
      filters: SmartSearchDto;
      personNames: Map<string, string>;
      tagNames: Map<string, string>;
    }
  | {
      ok: false;
      queryText: string;
      issues: TypedSearchIssue[];
      choices: TypedSearchChoice[];
    };

export async function resolveTypedSearchFilters(
  parsed: TypedSearchParseResult,
  context: TypedSearchResolveContext = {},
): Promise<TypedSearchResolveResult> {
  try {
    return await resolveTypedSearchFiltersInternal(parsed, context);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }

    return {
      ok: false,
      queryText: parsed.queryText,
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

async function resolveTypedSearchFiltersInternal(
  parsed: TypedSearchParseResult,
  context: TypedSearchResolveContext,
): Promise<TypedSearchResolveResult> {
  const filters: SmartSearchDto = {};
  const issues: TypedSearchIssue[] = [...parsed.issues];
  const choices: TypedSearchChoice[] = [];
  const personNames = new Map<string, string>();
  const tagNames = new Map<string, string>();

  if (issues.length > 0) {
    return { ok: false, queryText: parsed.queryText, issues, choices };
  }

  const countryToken = parsed.scalarTokens.find((token) => token.key === 'country');
  const cityToken = parsed.scalarTokens.find((token) => token.key === 'city');
  const rawTokenCounts = countResolutionTokenRawValues(parsed.resolutionTokens);
  const unresolvedTokens = parsed.resolutionTokens.filter(
    (token) => !getSelectedChoice(context, token, rawTokenCounts),
  );
  const needsTags = unresolvedTokens.some((token) => token.key === 'tag');
  const needsCamera = unresolvedTokens.some((token) => token.key === 'camera');

  const [tags, cameraMakes, countries] = await Promise.all([
    needsTags ? getAllTags({ signal: context.signal }) : Promise.resolve([] as TagResponseDto[]),
    needsCamera
      ? getSearchSuggestions({ $type: SearchSuggestionType.CameraMake }, { signal: context.signal })
      : Promise.resolve([] as string[]),
    countryToken
      ? getSearchSuggestions({ $type: SearchSuggestionType.Country }, { signal: context.signal })
      : Promise.resolve([] as string[]),
  ]);

  const canonicalScalarValues = new Map<TypedSearchScalarToken['key'], string>();
  if (countryToken) {
    canonicalScalarValues.set(
      'country',
      canonicalExactMatch(countries.filter(isString), String(countryToken.normalizedValue)),
    );
  }

  const country = countryToken ? canonicalScalarValues.get('country') : undefined;
  const citySuggestions = cityToken
    ? await getSearchSuggestions(
        { $type: SearchSuggestionType.City, ...(country ? { country } : {}) },
        { signal: context.signal },
      )
    : [];
  if (cityToken) {
    canonicalScalarValues.set(
      'city',
      canonicalExactMatch(citySuggestions.filter(isString), String(cityToken.normalizedValue)),
    );
  }

  const cameraModels = needsCamera
    ? await getSearchSuggestions({ $type: SearchSuggestionType.CameraModel }, { signal: context.signal })
    : [];

  for (const token of parsed.scalarTokens) {
    applyScalar(filters, token, canonicalScalarValues.get(token.key));
  }

  for (const token of parsed.resolutionTokens) {
    const selectedChoice = getSelectedChoice(context, token, rawTokenCounts);
    if (selectedChoice) {
      applySelectedChoice(selectedChoice, filters, personNames, tagNames);
      continue;
    }

    if (token.key === 'person') {
      const people = await searchPerson({ name: token.value, withHidden: false }, { signal: context.signal });
      resolvePersonToken(token, people, filters, personNames, issues, choices);
      continue;
    }

    if (token.key === 'tag') {
      resolveTagToken(token, tags, filters, tagNames, issues, choices);
      continue;
    }

    resolveCameraToken(token, cameraMakes, cameraModels, filters, issues, choices);
  }

  return issues.length > 0
    ? { ok: false, queryText: parsed.queryText, issues, choices }
    : { ok: true, queryText: parsed.queryText, filters, personNames, tagNames };
}

function countResolutionTokenRawValues(tokens: TypedSearchResolutionToken[]) {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token.raw, (counts.get(token.raw) ?? 0) + 1);
  }
  return counts;
}

function getSelectedChoice(
  context: TypedSearchResolveContext,
  token: TypedSearchResolutionToken,
  rawTokenCounts: Map<string, number>,
) {
  const identityChoice = context.selectedChoices?.get(token.identity);
  const stableChoice = context.selectedChoices?.get(token.stableIdentity);
  if (stableChoice) {
    return stableChoice;
  }
  if (identityChoice) {
    return identityChoice;
  }
  if (rawTokenCounts.get(token.raw) !== 1) {
    return undefined;
  }
  return context.selectedChoices?.get(token.raw);
}

function applyScalar(filters: SmartSearchDto, token: TypedSearchScalarToken, canonicalValue?: string) {
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
      filters.city = canonicalValue ?? String(token.normalizedValue);
      return;
    }
    case 'country': {
      filters.country = canonicalValue ?? String(token.normalizedValue);
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

function applySelectedChoice(
  choice: TypedSearchChoice,
  filters: SmartSearchDto,
  personNames: Map<string, string>,
  tagNames: Map<string, string>,
) {
  if (choice.key === 'person' && choice.id) {
    filters.personIds = [...(filters.personIds ?? []), choice.id];
    personNames.set(choice.id, choice.label);
    return;
  }

  if (choice.key === 'tag' && choice.id) {
    filters.tagIds = [...(filters.tagIds ?? []), choice.id];
    tagNames.set(choice.id, choice.label);
    return;
  }

  if (choice.key === 'camera' && choice.field) {
    filters[choice.field] = choice.label;
  }
}

function resolvePersonToken(
  token: TypedSearchResolutionToken,
  people: PersonResponseDto[],
  filters: SmartSearchDto,
  personNames: Map<string, string>,
  issues: TypedSearchIssue[],
  choices: TypedSearchChoice[],
) {
  const matches = people.filter((person) => person.name).filter((person) => matchesValue(person.name, token.value));
  if (matches.length === 1) {
    const match = matches[0];
    filters.personIds = [...(filters.personIds ?? []), match.id];
    personNames.set(match.id, match.name);
    return;
  }

  if (matches.length === 0) {
    issues.push(noMatchIssue(token, 'person'));
    return;
  }

  issues.push(ambiguousIssue(token, 'person'));
  choices.push(
    ...matches.map((person) => ({
      tokenRaw: token.raw,
      key: 'person' as const,
      id: person.id,
      label: person.name,
      value: token.value,
      tokenIdentity: token.stableIdentity,
    })),
  );
}

function resolveTagToken(
  token: TypedSearchResolutionToken,
  tags: TagResponseDto[],
  filters: SmartSearchDto,
  tagNames: Map<string, string>,
  issues: TypedSearchIssue[],
  choices: TypedSearchChoice[],
) {
  const matches = tags.filter((tag) => matchesValue(tag.value, token.value));
  if (matches.length === 1) {
    const match = matches[0];
    filters.tagIds = [...(filters.tagIds ?? []), match.id];
    tagNames.set(match.id, match.value);
    return;
  }

  if (matches.length === 0) {
    issues.push(noMatchIssue(token, 'tag'));
    return;
  }

  issues.push(ambiguousIssue(token, 'tag'));
  choices.push(
    ...matches.map((tag) => ({
      tokenRaw: token.raw,
      key: 'tag' as const,
      id: tag.id,
      label: tag.value,
      value: token.value,
      tokenIdentity: token.stableIdentity,
    })),
  );
}

function resolveCameraToken(
  token: TypedSearchResolutionToken,
  cameraMakes: string[],
  cameraModels: string[],
  filters: SmartSearchDto,
  issues: TypedSearchIssue[],
  choices: TypedSearchChoice[],
) {
  const makeMatches = cameraMakes.filter((make) => matchesValue(make, token.value));
  const modelMatches = cameraModels.filter((model) => matchesValue(model, token.value));
  const matches = [
    ...makeMatches.map((label) => ({ field: 'make' as const, label })),
    ...modelMatches.map((label) => ({ field: 'model' as const, label })),
  ];

  if (matches.length === 1) {
    filters[matches[0].field] = matches[0].label;
    return;
  }

  if (matches.length === 0) {
    issues.push(noMatchIssue(token, 'camera'));
    return;
  }

  issues.push(ambiguousIssue(token, 'camera'));
  choices.push(
    ...matches.map((match) => ({
      tokenRaw: token.raw,
      key: 'camera' as const,
      field: match.field,
      label: match.label,
      value: token.value,
      tokenIdentity: token.stableIdentity,
    })),
  );
}

function matchesValue(candidate: string, value: string) {
  return candidate.toLowerCase().includes(value.toLowerCase());
}

function canonicalExactMatch(candidates: string[], value: string) {
  return candidates.find((candidate) => candidate.toLowerCase() === value.toLowerCase()) ?? value;
}

function isString(value: string | null): value is string {
  return typeof value === 'string';
}

function noMatchIssue(token: TypedSearchResolutionToken, key: TypedSearchChoice['key']): TypedSearchIssue {
  return {
    code: 'no-match',
    key,
    raw: token.raw,
    value: token.value,
    message: `No ${key} found for "${token.value}"`,
    tokenIdentity: token.stableIdentity,
  };
}

function ambiguousIssue(token: TypedSearchResolutionToken, key: TypedSearchChoice['key']): TypedSearchIssue {
  return {
    code: 'ambiguous',
    key,
    raw: token.raw,
    value: token.value,
    message: `Choose a ${key} for "${token.value}"`,
    tokenIdentity: token.stableIdentity,
  };
}
