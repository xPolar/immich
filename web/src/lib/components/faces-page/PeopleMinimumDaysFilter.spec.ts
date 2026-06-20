import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import PeopleMinimumDaysFilter from './PeopleMinimumDaysFilter.svelte';

describe('PeopleMinimumDaysFilter', () => {
  it('applies a custom minimum number of days', async () => {
    const onApply = vi.fn();
    const { getByRole } = render(PeopleMinimumDaysFilter, { minimumDays: 2, onApply });
    const user = userEvent.setup();
    const input = getByRole('spinbutton');

    expect(input).toHaveValue(2);

    await user.clear(input);
    await user.type(input, '5');
    await user.click(getByRole('button'));

    expect(onApply).toHaveBeenCalledWith(5);
  });

  it('does not allow values below one day', async () => {
    const { getByRole } = render(PeopleMinimumDaysFilter, { minimumDays: 2, onApply: vi.fn() });
    const user = userEvent.setup();
    const input = getByRole('spinbutton');

    await user.clear(input);
    await user.type(input, '0');

    expect(getByRole('button')).toBeDisabled();
  });
});
