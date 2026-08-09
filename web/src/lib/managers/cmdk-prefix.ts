import type { PersonResponseDto } from '@immich/sdk';

export type GlobalSearchScope = 'all' | 'people' | 'tags' | 'albums' | 'commands';

const scopes: Record<string, GlobalSearchScope> = {
  '@': 'people',
  '#': 'tags',
  '/': 'albums',
  '>': 'commands',
};

export function parseGlobalSearchScope(value: string) {
  const query = value.trim();
  const scope = scopes[query[0]] ?? 'all';
  return { scope, query: scope === 'all' ? query : query.slice(1).trim() };
}

export const compareGlobalSearchPeople = (a: PersonResponseDto, b: PersonResponseDto) =>
  Number(Boolean(b.isFavorite)) - Number(Boolean(a.isFavorite)) ||
  Number(!a.name) - Number(!b.name) ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);
