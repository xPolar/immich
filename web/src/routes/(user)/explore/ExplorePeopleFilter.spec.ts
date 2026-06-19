import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ExplorePeopleFilter from './ExplorePeopleFilter.svelte';

describe('ExplorePeopleFilter', () => {
  it('applies a custom minimum number of days', async () => {
    const onApply = vi.fn();
    const { getByRole } = render(ExplorePeopleFilter, { minimumDays: 2, onApply });
    const user = userEvent.setup();
    const input = getByRole('spinbutton');

    expect(input).toHaveValue(2);

    await user.clear(input);
    await user.type(input, '5');
    await user.click(getByRole('button'));

    expect(onApply).toHaveBeenCalledWith(5);
  });

  it('does not allow values below one day', async () => {
    const { getByRole } = render(ExplorePeopleFilter, { minimumDays: 2, onApply: vi.fn() });
    const user = userEvent.setup();
    const input = getByRole('spinbutton');

    await user.clear(input);
    await user.type(input, '0');

    expect(getByRole('button')).toBeDisabled();
  });
});
