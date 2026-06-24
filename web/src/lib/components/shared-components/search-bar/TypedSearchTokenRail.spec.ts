import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import TypedSearchTokenRail from './TypedSearchTokenRail.svelte';

describe('TypedSearchTokenRail', () => {
  it('renders recognized and pending filters as key-value capsules', () => {
    render(TypedSearchTokenRail, {
      tokens: [
        { raw: 'from:2025', key: 'from', value: '2025', status: 'recognized' },
        { raw: 'person:anna', key: 'person', value: 'anna', status: 'pending-entity' },
      ],
    });

    expect(screen.getByTestId('typed-search-token-rail')).toHaveClass('px-4', 'pt-2', 'pb-1');
    expect(screen.getByTestId('typed-search-token-person')).toHaveAttribute('data-status', 'pending-entity');
    expect(screen.getByTestId('typed-search-token-person-key')).toHaveClass('uppercase', 'tracking-[0.08em]');
    expect(screen.getByTestId('typed-search-token-person-value')).toHaveTextContent('anna');
  });

  it('renders errors with issue text and resolved entities in green state', () => {
    render(TypedSearchTokenRail, {
      tokens: [
        {
          raw: 'rating:9',
          key: 'rating',
          value: '9',
          status: 'error',
          issue: {
            code: 'invalid-rating',
            raw: 'rating:9',
            key: 'rating',
            value: '9',
            message: 'Rating must be between 1 and 5',
          },
        },
        { raw: 'person:Anna', key: 'person', value: 'Anna', status: 'resolved-entity' },
      ],
    });

    expect(screen.getByLabelText('Rating must be between 1 and 5')).toHaveAttribute('data-status', 'error');
    expect(screen.getByTestId('typed-search-token-person')).toHaveAttribute('data-status', 'resolved-entity');
  });
});
