import { render } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import MapFilterPanelTest from './__test__/MapFilterPanelTest.svelte';

describe('MapFilterPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('visualViewport', null);
    sdkMock.getAllPeople.mockResolvedValue({ people: [], total: 0, hidden: 0 });
    sdkMock.getAllTags.mockResolvedValue([]);
    sdkMock.getSearchSuggestions.mockResolvedValue([]);
  });

  it('should render map-specific filters without a location filter', () => {
    const { getByText, queryByText } = render(MapFilterPanelTest);

    expect(getByText('filters')).toBeInTheDocument();
    expect(getByText('camera')).toBeInTheDocument();
    expect(getByText('start_date')).toBeInTheDocument();
    expect(getByText('media_type')).toBeInTheDocument();
    expect(getByText('only_favorites')).toBeInTheDocument();
    expect(queryByText('location')).not.toBeInTheDocument();
  });
});
