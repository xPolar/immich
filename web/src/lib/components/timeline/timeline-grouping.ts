import type { TimelineMonth } from '$lib/managers/timeline-manager/timeline-month.svelte';

type TimelineMonthGroup = Pick<TimelineMonth, 'assetsCount' | 'yearMonth'>;

export const groupTimelineMonthsByYear = <T extends TimelineMonthGroup>(months: T[]) => {
  const groups: Array<{ year: number; count: number; months: T[] }> = [];

  for (const month of months) {
    const current = groups.at(-1);
    if (current?.year === month.yearMonth.year) {
      current.count += month.assetsCount;
      current.months.push(month);
    } else {
      groups.push({ year: month.yearMonth.year, count: month.assetsCount, months: [month] });
    }
  }

  return groups;
};
