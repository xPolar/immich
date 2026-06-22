import '@testing-library/jest-dom';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { AssetMultiSelectManager } from '$lib/managers/asset-multi-select-manager.svelte';
import { TimelineManager } from '$lib/managers/timeline-manager/timeline-manager.svelte';
import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
import { fromISODateTimeUTCToObject } from '$lib/utils/timeline-util';
import { timelineAssetFactory } from '@test-data/factories/asset-factory';
import Month from './Month.svelte';

const thumbnail = createRawSnippet(() => ({
  render: () => '<div data-testid="timeline-thumbnail"></div>',
}));

const buildAsset = (): TimelineAsset => {
  const asset = timelineAssetFactory.build({
    fileCreatedAt: fromISODateTimeUTCToObject('2024-01-20T12:00:00.000Z'),
  });
  return { ...asset, localDateTime: asset.fileCreatedAt };
};

describe('Month component', () => {
  beforeAll(async () => {
    await init({ fallbackLocale: 'en-US' });
    register('en-US', () => import('$i18n/en.json'));
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders timeline collapse controls and toggles the day', async () => {
    const timelineManager = new TimelineManager();
    const assetInteraction = new AssetMultiSelectManager();
    sdkMock.getTimeBuckets.mockResolvedValue([]);
    await timelineManager.updateViewport({ width: 1588, height: 1000 });
    timelineManager.upsertAssets([buildAsset()]);
    const timelineMonth = timelineManager.months[0];
    const timelineDay = timelineMonth.timelineDays[0];
    const user = userEvent.setup();
    const sut = render(Month, {
      assetInteraction,
      manager: timelineManager,
      onTimelineDaySelect: vi.fn(),
      singleSelect: false,
      thumbnail,
      timelineMonth,
    });

    expect(sut.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true');
    expect(sut.getByRole('button', { name: 'Expand all' })).toBeInTheDocument();
    expect(sut.getByRole('button', { name: 'Collapse all' })).toBeInTheDocument();

    await user.click(sut.getByRole('button', { name: 'Collapse' }));

    expect(timelineDay.isCollapsed).toBe(true);
    expect(sut.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false');

    await user.click(sut.getByRole('button', { name: 'Expand all' }));

    expect(timelineDay.isCollapsed).toBe(false);
    expect(sut.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true');
  });
});
