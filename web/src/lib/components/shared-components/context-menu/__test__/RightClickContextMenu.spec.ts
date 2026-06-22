import { render } from '@testing-library/svelte';
import RightClickContextMenu from '$lib/components/shared-components/context-menu/RightClickContextMenu.svelte';

describe('RightClickContextMenu', () => {
  it('renders a viewport overlay above the underlying asset grid', () => {
    const sut = render(RightClickContextMenu, {
      title: 'Asset actions',
      isOpen: true,
      onClose: vi.fn(),
    });

    expect(sut.getByRole('presentation')).toHaveClass('z-9999', 'pointer-events-auto');
  });
});
