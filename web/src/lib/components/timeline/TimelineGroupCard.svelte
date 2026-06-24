<script lang="ts">
  import Image from '$lib/components/Image.svelte';
  import Thumbhash from '$lib/components/Thumbhash.svelte';
  import type { TimelineMonth } from '$lib/managers/timeline-manager/timeline-month.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize } from '@immich/sdk';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    title: string;
    count: number;
    coverMonths: TimelineMonth[];
    year: number;
    month?: number;
    onClick: () => void;
  }

  let { title, count, coverMonths, year, month, onClick }: Props = $props();

  let element: HTMLButtonElement | undefined = $state();
  let loading = false;
  const coverAsset = $derived(coverMonths.find((timelineMonth) => timelineMonth.getFirstAsset())?.getFirstAsset());

  const loadCover = async () => {
    if (loading || coverAsset) {
      return;
    }

    loading = true;
    for (const timelineMonth of coverMonths) {
      await timelineMonth.timelineManager.loadTimelineMonth(timelineMonth.yearMonth, { cancelable: false });
      if (timelineMonth.getFirstAsset()) {
        break;
      }
    }
    loading = false;
  };

  onMount(() => {
    if (!element || typeof IntersectionObserver === 'undefined') {
      void loadCover();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          void loadCover();
          observer.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(element);

    return () => observer.disconnect();
  });
</script>

<button
  bind:this={element}
  type="button"
  data-timeline-group
  data-timeline-year={year}
  data-timeline-month={month}
  class="group relative block h-40 w-full overflow-hidden rounded-2xl bg-gray-200 text-start shadow-sm transition-shadow outline-none hover:shadow-lg focus-visible:ring-3 focus-visible:ring-immich-primary/80 sm:h-48 md:h-64 lg:h-72 dark:bg-gray-800 dark:focus-visible:ring-immich-dark-primary/80"
  aria-label={`${title}, ${$t('photos_count', { values: { count } })}`}
  onclick={onClick}
>
  {#if coverAsset}
    {#if coverAsset.thumbhash}
      <Thumbhash base64ThumbHash={coverAsset.thumbhash} class="absolute inset-0 size-full object-cover" />
    {/if}
    <Image
      src={getAssetMediaUrl({
        id: coverAsset.id,
        size: AssetMediaSize.Preview,
        cacheKey: coverAsset.thumbhash,
      })}
      alt=""
      loading="lazy"
      class="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
    />
  {/if}

  <div class="absolute inset-0 bg-linear-to-t from-black/80 via-black/15 to-transparent"></div>
  <div class="absolute inset-x-0 bottom-0 p-4 text-white md:p-6">
    <h2 class="text-2xl font-semibold tracking-tight md:text-4xl">{title}</h2>
    <span class="mt-1 inline-flex rounded-full bg-white/90 px-2.5 py-1 text-xs font-medium text-gray-900 md:text-sm">
      {$t('photos_count', { values: { count } })}
    </span>
  </div>
</button>
