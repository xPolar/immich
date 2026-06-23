import { describe, expect, it } from 'vitest';
import { groupTimelineMonthsByYear } from './timeline-grouping';

describe('groupTimelineMonthsByYear', () => {
  it('keeps timeline order and totals each year', () => {
    const months = [
      { yearMonth: { year: 2025, month: 2 }, assetsCount: 2 },
      { yearMonth: { year: 2025, month: 1 }, assetsCount: 3 },
      { yearMonth: { year: 2023, month: 12 }, assetsCount: 4 },
    ];

    expect(groupTimelineMonthsByYear(months)).toEqual([
      { year: 2025, count: 5, months: months.slice(0, 2) },
      { year: 2023, count: 4, months: months.slice(2) },
    ]);
  });
});
