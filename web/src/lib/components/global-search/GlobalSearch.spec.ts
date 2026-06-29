import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalSearchTestWrapper from './GlobalSearchTestWrapper.svelte';

const { manager } = vi.hoisted(() => ({
  manager: {
    isOpen: true,
    presentation: 'modal',
    query: '',
    scope: 'all',
    mode: 'smart',
    loading: false,
    activeIndex: 0,
    activeResult: undefined,
    results: [],
    recents: [],
    typedIssues: [],
    smartSearchUnavailable: false,
    sections: {},
    providerErrors: {},
    typedPlainQuery: '',
    toggle: vi.fn(),
    close: vi.fn(),
    setQuery: vi.fn(),
    cycleMode: vi.fn(),
    setMode: vi.fn(),
    setInputCaret: vi.fn(),
    move: vi.fn(),
    moveTo: vi.fn(),
    activate: vi.fn(),
    removeRecent: vi.fn(),
  },
}));

vi.mock('$lib/managers/global-search-manager.svelte', () => ({ globalSearchManager: manager }));
vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: { authenticated: true } }));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({ featureFlagsManager: { value: { search: true } } }));
vi.mock('$lib/utils', () => ({ getAssetMediaUrl: vi.fn(), getPeopleThumbnailUrl: vi.fn() }));

describe('GlobalSearch modal', () => {
  beforeEach(() => {
    manager.query = '';
    manager.scope = 'all';
    manager.activeIndex = 0;
    manager.activeResult = undefined;
    manager.results = [];
    vi.clearAllMocks();
  });

  it('uses full-height single-column mobile classes and desktop modal classes', () => {
    const { container } = render(GlobalSearchTestWrapper);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toHaveClass('size-full', 'sm:h-auto', 'sm:max-h-[82vh]', 'sm:rounded-2xl');
    expect(container.querySelector('aside')).toHaveClass('hidden', 'lg:block');
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '256');
  });

  it('wraps Tab across the entire dialog in both directions', async () => {
    render(GlobalSearchTestWrapper);
    const input = screen.getByRole('textbox');
    const buttons = screen.getAllByRole('button');
    const last = buttons.at(-1)!;

    last.focus();
    await fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(input);

    input.focus();
    await fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('autofocuses the modal input on open', async () => {
    render(GlobalSearchTestWrapper);
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('captures Cmd+K before the built-in command palette shortcut', async () => {
    render(GlobalSearchTestWrapper);
    await tick();
    const commandPaletteShortcut = vi.fn();
    document.body.addEventListener('keydown', commandPaletteShortcut);
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true });

    document.body.dispatchEvent(event);

    document.body.removeEventListener('keydown', commandPaletteShortcut);
    expect(commandPaletteShortcut).not.toHaveBeenCalled();
    expect(manager.toggle).toHaveBeenCalledWith('modal');
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes on backdrop click', async () => {
    const { container } = render(GlobalSearchTestWrapper);
    const backdrop = container.querySelector<HTMLElement>('[role="presentation"]')!;

    await fireEvent.mouseDown(backdrop);

    expect(manager.close).toHaveBeenCalledOnce();
  });

  it('skips disabled scoped mode controls and closes on Escape outside the input', async () => {
    manager.scope = 'people';
    manager.query = 'cats';
    render(GlobalSearchTestWrapper);
    const input = screen.getByRole('textbox');
    const close = screen.getByRole('button', { name: /close/i });

    close.focus();
    await fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(input);

    close.focus();
    await fireEvent.keyDown(close, { key: 'Escape' });
    expect(manager.close).toHaveBeenCalledOnce();
    expect(manager.setQuery).not.toHaveBeenCalled();
  });

  it('closes instead of clearing when Escape is pressed in a populated modal input', async () => {
    manager.query = 'cats';
    render(GlobalSearchTestWrapper);

    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    expect(manager.close).toHaveBeenCalledOnce();
    expect(manager.setQuery).not.toHaveBeenCalled();
  });

  it('labels a promoted command as the Top result', () => {
    const command = {
      id: 'cmd:upload',
      kind: 'command',
      item: { id: 'cmd:upload', labelKey: 'upload', icon: '', run: vi.fn() },
    };
    manager.query = 'upload';
    manager.results = [command] as never;
    manager.activeResult = command as never;
    render(GlobalSearchTestWrapper);
    expect(screen.getByText('Top result')).toBeInTheDocument();
  });

  it('starts the natural section after a promoted top result', () => {
    const commands = [
      {
        id: 'cmd:upload',
        kind: 'command',
        item: { id: 'cmd:upload', labelKey: 'upload', icon: '', run: vi.fn() },
      },
      {
        id: 'cmd:new-album',
        kind: 'command',
        item: { id: 'cmd:new-album', labelKey: 'new_album', icon: '', run: vi.fn() },
      },
    ];
    manager.query = 'upload';
    manager.results = commands as never;
    manager.activeResult = commands[0] as never;
    render(GlobalSearchTestWrapper);
    expect(screen.getByText('Top result')).toBeInTheDocument();
    expect(screen.getAllByText('Commands')).not.toHaveLength(0);
  });
});
