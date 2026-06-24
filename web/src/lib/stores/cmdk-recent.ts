import { authManager } from '$lib/managers/auth-manager.svelte';

const storagePrefix = 'cmdk.recent:';
const maximumEntries = 20;

export type GlobalSearchRecent =
  | { id: string; kind: 'query'; label: string; value: string; lastUsed: number }
  | { id: string; kind: 'destination'; label: string; value: string; lastUsed: number };

const storageKey = () => (authManager.authenticated ? `${storagePrefix}${authManager.user.id}` : undefined);

export function getGlobalSearchRecents(): GlobalSearchRecent[] {
  const key = storageKey();
  if (!key || typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(entries)
      ? entries
          .filter(
            (entry): entry is GlobalSearchRecent =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof entry.id === 'string' &&
              typeof entry.label === 'string' &&
              typeof entry.value === 'string' &&
              typeof entry.lastUsed === 'number',
          )
          .sort((a, b) => b.lastUsed - a.lastUsed)
      : [];
  } catch {
    return [];
  }
}

export function addGlobalSearchRecent(entry: Omit<GlobalSearchRecent, 'lastUsed'>) {
  const key = storageKey();
  if (!key || typeof localStorage === 'undefined') {
    return;
  }
  const entries = getGlobalSearchRecents().filter(({ id }) => id !== entry.id);
  localStorage.setItem(key, JSON.stringify([{ ...entry, lastUsed: Date.now() }, ...entries].slice(0, maximumEntries)));
}

export function removeGlobalSearchRecent(id: string) {
  const key = storageKey();
  if (key && typeof localStorage !== 'undefined') {
    localStorage.setItem(key, JSON.stringify(getGlobalSearchRecents().filter((entry) => entry.id !== id)));
  }
}

export function clearGlobalSearchRecents() {
  const key = storageKey();
  if (key && typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
  }
}
