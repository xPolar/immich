import { getAllPeople } from '@immich/sdk';
import userEvent from '@testing-library/user-event';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import { renderWithTooltips } from '$tests/helpers';
import { personFactory } from '@test-data/factories/person-factory';
import PeoplePage from './+page.svelte';

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: { init: vi.fn(), loadFeatureFlags: vi.fn(), value: {} } as never,
}));

vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({ url: new URL('http://localhost/people') }),
  };
});

vi.mock('$app/navigation', () => ({
  goto: vi.fn(),
  replaceState: vi.fn(),
}));

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  return await import('@test-data/mocks/UserPageLayout.mock.svelte');
});

vi.mock('@immich/sdk', async () => {
  const sdk = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...sdk,
    getAllPeople: vi.fn(),
  };
});

describe('People page minimum-days filter', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  });

  it('refetches and replaces people when the filter is applied', async () => {
    const firstPerson = personFactory.build({ id: 'first-person', name: 'First person', isHidden: false });
    const filteredPerson = personFactory.build({ id: 'filtered-person', name: 'Filtered person', isHidden: false });
    vi.mocked(getAllPeople).mockResolvedValue({
      people: [filteredPerson],
      total: 1,
      hidden: 0,
      hasNextPage: false,
    });

    const { container, findByDisplayValue, queryByDisplayValue } = renderWithTooltips(PeoplePage, {
      data: {
        error: undefined,
        meta: { title: 'People' },
        asset: undefined,
        minimumDays: 2,
        people: {
          people: [firstPerson],
          total: 1,
          hidden: 0,
          hasNextPage: false,
        },
      },
    });
    const user = userEvent.setup();
    const input = container.querySelector<HTMLInputElement>('#people-minimum-days-content')!;
    const applyButton = input.closest('form')!.querySelector<HTMLButtonElement>('button')!;

    await user.clear(input);
    await user.type(input, '5');
    await user.click(applyButton);

    expect(getAllPeople).toHaveBeenCalledWith({ withHidden: true, minimumDays: 5 });
    expect(await findByDisplayValue('Filtered person')).toBeInTheDocument();
    expect(queryByDisplayValue('First person')).not.toBeInTheDocument();
  });
});
