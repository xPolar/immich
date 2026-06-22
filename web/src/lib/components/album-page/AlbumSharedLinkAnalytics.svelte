<script lang="ts">
  import SharedLinkAnalyticsModal from '$lib/modals/SharedLinkAnalyticsModal.svelte';
  import { getAlbumSharedLinkViews, type SharedLinkViewResponseDto } from '@immich/sdk';
  import { Button, modalManager } from '@immich/ui';
  import { mdiChartLine } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    albumId: string;
  };

  const { albumId }: Props = $props();
  let analytics: SharedLinkViewResponseDto | undefined = $state();
  let requestGeneration = 0;

  $effect(() => {
    const id = albumId;
    const generation = ++requestGeneration;
    analytics = undefined;

    void getAlbumSharedLinkViews({ id, period: 'all' })
      .then((response) => {
        if (generation === requestGeneration) {
          analytics = response;
        }
      })
      .catch(() => {
        if (generation === requestGeneration) {
          analytics = undefined;
        }
      });

    return () => {
      requestGeneration++;
    };
  });

  const showAnalytics = () => modalManager.show(SharedLinkAnalyticsModal, { target: { type: 'album', albumId } });
</script>

{#if analytics}
  <Button size="small" color="secondary" variant="outline" leadingIcon={mdiChartLine} onclick={showAnalytics}>
    {$t('public_link_views_summary', {
      values: { views: analytics.totalViews.toLocaleString(), browsers: analytics.uniqueBrowsers.toLocaleString() },
    })}
  </Button>
{/if}
