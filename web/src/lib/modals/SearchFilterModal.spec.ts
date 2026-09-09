import { getAllPeople, getAllTags, getSearchLibraries, getSearchSuggestions } from '@immich/sdk';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAnimateMock } from '$lib/__mocks__/animate.mock';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { getVisualViewportMock } from '$lib/__mocks__/visual-viewport.mock';
import SearchFilterModal from './SearchFilterModal.svelte';

vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal()),
  getAllPeople: vi.fn(),
  getAllTags: vi.fn(),
  getSearchLibraries: vi.fn(),
  getSearchSuggestions: vi.fn(),
}));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { value: { smartSearch: true, ocr: true } },
}));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: { authenticated: false } }));

describe('SearchFilterModal library filter', () => {
  const applePhotosId = '00000000-0000-4000-8000-000000000001';
  const dasId = '00000000-0000-4000-8000-000000000002';
  const onClose = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    Element.prototype.animate = getAnimateMock();
    localStorage.clear();
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
    vi.stubGlobal('visualViewport', getVisualViewportMock());
    vi.mocked(getAllPeople).mockResolvedValue({ people: [] } as never);
    vi.mocked(getAllTags).mockResolvedValue([]);
    vi.mocked(getSearchSuggestions).mockResolvedValue([]);
    vi.mocked(getSearchLibraries).mockResolvedValue([
      { id: applePhotosId, name: 'Apple Photos' },
      { id: dasId, name: 'DAS' },
    ]);
  });

  async function selectLibrary(name: string) {
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'library' }));
    await user.click(await screen.findByRole('option', { name }));
  }

  async function submit() {
    await fireEvent.click(screen.getByRole('button', { name: 'search' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    return onClose.mock.calls[0][0];
  }

  it('defaults to all libraries without adding a library constraint', async () => {
    render(SearchFilterModal, { searchQuery: {}, onClose });

    expect(screen.getByRole('combobox', { name: 'library' })).toHaveValue('all_libraries');
    expect(await submit()).toHaveProperty('libraryId', undefined);
  });

  it.each([
    ['Apple Photos', applePhotosId],
    ['DAS', dasId],
  ])('submits only the selected %s library alongside context filters', async (name, libraryId) => {
    render(SearchFilterModal, { searchQuery: { query: 'beach', isFavorite: true }, onClose });

    await selectLibrary(name);

    expect(await submit()).toMatchObject({ libraryId, query: 'beach', isFavorite: true });
  });

  it('preserves the library when reopening a filename search', async () => {
    localStorage.setItem('searchQueryType', 'metadata');
    render(SearchFilterModal, { searchQuery: { libraryId: dasId, originalFileName: 'IMG' }, onClose });

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'library' })).toHaveValue('DAS'));

    expect(await submit()).toMatchObject({ libraryId: dasId, originalFileName: 'IMG' });
  });

  it('uses an explicit null to search uploads outside external libraries', async () => {
    render(SearchFilterModal, { searchQuery: {}, onClose });
    await selectLibrary('search_library_uploads');

    expect(await submit()).toHaveProperty('libraryId', null);
  });

  it('restores the uploads selection rather than treating null as all libraries', async () => {
    render(SearchFilterModal, { searchQuery: { libraryId: null }, onClose });

    expect(screen.getByRole('combobox', { name: 'library' })).toHaveValue('search_library_uploads');
    expect(await submit()).toHaveProperty('libraryId', null);
  });

  it('removes the library constraint when all libraries is selected', async () => {
    render(SearchFilterModal, { searchQuery: { libraryId: dasId }, onClose });
    await selectLibrary('all_libraries');

    expect(await submit()).toHaveProperty('libraryId', undefined);
  });

  it('clears the library constraint with Clear all', async () => {
    render(SearchFilterModal, { searchQuery: { libraryId: dasId }, onClose });
    await fireEvent.click(screen.getByRole('button', { name: 'clear_all' }));

    expect(screen.getByRole('combobox', { name: 'library' })).toHaveValue('all_libraries');
    expect(await submit()).toHaveProperty('libraryId', undefined);
  });

  it('reports a library loading failure without silently discarding the active filter', async () => {
    vi.mocked(getSearchLibraries).mockRejectedValue(new Error('Unavailable'));
    render(SearchFilterModal, { searchQuery: { libraryId: dasId }, onClose });

    expect(await screen.findByRole('alert')).toHaveTextContent('errors.failed_to_load_libraries');
    expect(await submit()).toHaveProperty('libraryId', dasId);
  });
});
