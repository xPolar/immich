import { getAllPeople } from '@immich/sdk';
import { get } from 'svelte/store';
import { DEFAULT_PEOPLE_MINIMUM_DAYS, peopleViewSettings } from '$lib/stores/preferences.store';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);

  const storedMinimumDays = get(peopleViewSettings).minimumDays;
  const minimumDays =
    Number.isInteger(storedMinimumDays) && storedMinimumDays >= 1 ? storedMinimumDays : DEFAULT_PEOPLE_MINIMUM_DAYS;
  const people = await getAllPeople({ withHidden: true, minimumDays });
  const $t = await getFormatter();

  return {
    people,
    minimumDays,
    meta: {
      title: $t('people'),
    },
  };
}) satisfies PageLoad;
