import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalSearchInputTrigger from './GlobalSearchInputTrigger.svelte';

const { manager } = vi.hoisted(() => ({
  manager: {
    isOpen: false,
    presentation: 'modal',
    query: '',
    activeIndex: 0,
    activeResult: undefined,
    results: [],
    smartSearchUnavailable: false,
    providerErrors: {},
    scope: 'all',
    mode: 'smart',
    loading: false,
    open: vi.fn((presentation: string) => {
      manager.isOpen = true;
      manager.presentation = presentation;
    }),
    close: vi.fn(),
    setQuery: vi.fn(),
    move: vi.fn(),
    moveTo: vi.fn(),
    activate: vi.fn(),
    removeRecent: vi.fn(),
    setMode: vi.fn(),
    cycleMode: vi.fn(),
  },
}));

vi.mock('$lib/managers/global-search-manager.svelte', () => ({ globalSearchManager: manager }));

describe('GlobalSearchInputTrigger', () => {
  beforeEach(() => {
    manager.isOpen = false;
    manager.presentation = 'modal';
    manager.results = [];
    manager.activeResult = undefined;
    vi.clearAllMocks();
  });

  it('opens the anchored dropdown rather than the modal on focus', async () => {
    render(GlobalSearchInputTrigger);
    const input = screen.getByRole('textbox');
    await fireEvent.focus(input);
    expect(manager.open).toHaveBeenCalledWith('dropdown', expect.any(HTMLInputElement));
    expect(input).toHaveAttribute('maxlength', '256');
  });

  it('activates a cold-start Quick Link from the keyboard', async () => {
    const quickLink = {
      id: 'nav:photos',
      kind: 'navigation',
      item: { id: 'nav:photos', labelKey: 'photos', route: '/photos', icon: '', category: 'user' },
    };
    manager.results = [quickLink] as never;
    manager.activeResult = quickLink as never;
    render(GlobalSearchInputTrigger);
    const input = screen.getByRole('textbox');
    await fireEvent.focus(input);
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(manager.activate).toHaveBeenCalledWith();
  });

  it('clears a populated dropdown on first Escape and closes on second Escape', async () => {
    manager.query = 'cats';
    manager.isOpen = true;
    manager.presentation = 'dropdown';
    render(GlobalSearchInputTrigger);
    const input = screen.getByRole('textbox');

    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(manager.setQuery).toHaveBeenCalledWith('');
    expect(manager.close).not.toHaveBeenCalled();

    manager.query = '';
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(manager.close).toHaveBeenCalledOnce();
  });

  it('cycles modes with Ctrl+/', async () => {
    render(GlobalSearchInputTrigger);
    const input = screen.getByRole('textbox');
    await fireEvent.keyDown(input, { key: '/', ctrlKey: true });
    expect(manager.cycleMode).toHaveBeenCalledOnce();
  });
});
