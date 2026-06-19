import { getAllPeople, getExploreData } from '@immich/sdk';
import { get } from 'svelte/store';
import { DEFAULT_EXPLORE_MINIMUM_DAYS, exploreViewSettings } from '$lib/stores/preferences.store';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const storedMinimumDays = get(exploreViewSettings).minimumDays;
  const minimumDays =
    Number.isInteger(storedMinimumDays) && storedMinimumDays >= 1 ? storedMinimumDays : DEFAULT_EXPLORE_MINIMUM_DAYS;
  const [items, response] = await Promise.all([getExploreData(), getAllPeople({ withHidden: false, minimumDays })]);
  const $t = await getFormatter();

  return {
    items,
    response,
    minimumDays,
    meta: {
      title: $t('explore'),
    },
  };
}) satisfies PageLoad;
