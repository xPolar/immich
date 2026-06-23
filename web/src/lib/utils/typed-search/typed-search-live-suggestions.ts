import { getAllPeople, getAllTags, getSearchSuggestions, searchPerson, SearchSuggestionType } from '@immich/sdk';
import type { TypedSearchParseResult, TypedSearchTokenSpan } from './typed-search-parser';
import type { TypedSearchChoice } from './typed-search-resolver';

const suggestionLimit = 6;

function tokenSpan(token: TypedSearchTokenSpan) {
  return { tokenStart: token.start, tokenEnd: token.end };
}

export function isLiveTypedSearchToken(token?: TypedSearchTokenSpan) {
  return (
    token?.key === 'person' ||
    token?.key === 'tag' ||
    token?.key === 'country' ||
    token?.key === 'city' ||
    token?.key === 'camera'
  );
}

export async function getLiveTypedSearchSuggestions(
  parsed: TypedSearchParseResult,
  token: TypedSearchTokenSpan,
  signal?: AbortSignal,
): Promise<TypedSearchChoice[]> {
  const value = token.value.trim().toLowerCase();
  switch (token.key) {
    case 'person': {
      let people;
      if (token.value.trim()) {
        people = await searchPerson({ name: token.value, withHidden: false }, { signal });
      } else {
        const response = await getAllPeople({ size: 100, withHidden: false }, { signal });
        people = response.people;
      }
      return people
        .filter((person) => person.name && (!value || person.name.toLowerCase().includes(value)))
        .slice(0, suggestionLimit)
        .map((person) => ({
          key: 'person',
          id: person.id,
          label: person.name,
          value: token.value,
          ...tokenSpan(token),
        }));
    }
    case 'tag': {
      const tags = await getAllTags({ signal });
      return tags
        .filter((tag) => !value || tag.value.toLowerCase().includes(value))
        .slice(0, suggestionLimit)
        .map((tag) => ({ key: 'tag', id: tag.id, label: tag.value, value: token.value, ...tokenSpan(token) }));
    }
    case 'country': {
      const countries = await getSearchSuggestions({ $type: SearchSuggestionType.Country }, { signal });
      return countries
        .filter((country) => !value || country.toLowerCase().includes(value))
        .slice(0, suggestionLimit)
        .map((country) => ({
          key: 'country' as const,
          label: country,
          value: token.value,
          ...tokenSpan(token),
        }));
    }
    case 'city': {
      const country = parsed.scalarTokens.find((item) => item.key === 'country');
      const cities = await getSearchSuggestions(
        {
          $type: SearchSuggestionType.City,
          country: country ? String(country.normalizedValue) : undefined,
        },
        { signal },
      );
      return cities
        .filter((city) => !value || city.toLowerCase().includes(value))
        .slice(0, suggestionLimit)
        .map((city) => ({ key: 'city' as const, label: city, value: token.value, ...tokenSpan(token) }));
    }
    case 'camera': {
      const [makes, models] = await Promise.all([
        getSearchSuggestions({ $type: SearchSuggestionType.CameraMake }, { signal }),
        getSearchSuggestions({ $type: SearchSuggestionType.CameraModel }, { signal }),
      ]);
      return [
        ...makes.map((label) => ({
          key: 'camera' as const,
          field: 'make' as const,
          label,
          value: token.value,
          ...tokenSpan(token),
        })),
        ...models.map((label) => ({
          key: 'camera' as const,
          field: 'model' as const,
          label,
          value: token.value,
          ...tokenSpan(token),
        })),
      ]
        .filter((choice) => !value || choice.label.toLowerCase().includes(value))
        .slice(0, suggestionLimit);
    }
    default: {
      return [];
    }
  }
}
