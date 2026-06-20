import { fireEvent, render } from '@testing-library/svelte';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import Thumbnail from '$lib/components/assets/thumbnail/Thumbnail.svelte';
import { getTabbable } from '$lib/utils/focus-util';
import { assetFactory } from '@test-data/factories/asset-factory';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    enumerable: true,
    value: vi.fn().mockImplementation(function (query) {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated
        removeListener: vi.fn(), // deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
});

vi.mock('$lib/utils/navigation', () => ({
  currentUrlReplaceAssetId: vi.fn(),
  isSharedLinkRoute: vi.fn().mockReturnValue(false),
}));

describe('Thumbnail component', () => {
  beforeAll(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  });

  it('should only contain a single tabbable element (the container)', () => {
    const asset = assetFactory.build({ originalPath: 'image.jpg', originalMimeType: 'image/jpeg' });
    const { baseElement } = render(Thumbnail, {
      asset,
      selected: true,
    });

    const container = baseElement.querySelector('[data-thumbnail-focus-container]');
    expect(container).not.toBeNull();
    expect(container!.getAttribute('tabindex')).toBe('0');

    // Guarding against inserting extra tabbable elements in future in <Thumbnail/>
    const tabbables = getTabbable(container!);
    expect(tabbables.length).toBe(0);
  });

  it('shows thumbhash while image is loading', () => {
    const asset = assetFactory.build({ originalPath: 'image.jpg', originalMimeType: 'image/jpeg' });
    const sut = render(Thumbnail, {
      asset,
      selected: true,
    });

    const thumbhash = sut.getByTestId('thumbhash');
    expect(thumbhash).not.toBeFalsy();
  });

  it('opens a custom context menu at the pointer position', () => {
    const asset = assetFactory.build({ originalPath: 'image.jpg', originalMimeType: 'image/jpeg' });
    const onShowContextMenu = vi.fn();
    const sut = render(Thumbnail, { asset, onShowContextMenu });
    const container = sut.getByRole('link');

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 80 });
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onShowContextMenu).toHaveBeenCalledWith({ x: 120, y: 80 }, expect.objectContaining({ id: asset.id }));
  });

  it('opens a custom context menu from the keyboard', async () => {
    const asset = assetFactory.build({ originalPath: 'image.jpg', originalMimeType: 'image/jpeg' });
    const onShowContextMenu = vi.fn();
    const sut = render(Thumbnail, { asset, onShowContextMenu });
    const container = sut.getByRole('link');
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      top: 20,
      right: 210,
      bottom: 120,
      left: 10,
      toJSON: () => {},
    });

    await fireEvent.keyDown(container, { key: 'F10', shiftKey: true });

    expect(onShowContextMenu).toHaveBeenCalledWith({ x: 110, y: 70 }, expect.objectContaining({ id: asset.id }));
  });
});
