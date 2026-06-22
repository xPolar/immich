<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { getSharedLinkViews, type SharedLinkResponseDto, type SharedLinkViewResponseDto } from '@immich/sdk';
  import { Button, LoadingSpinner, Modal, ModalBody, Text } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import uPlot, { type AlignedData } from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  type Period = '30d' | '90d' | 'all';

  type Props = {
    sharedLink: SharedLinkResponseDto;
    onClose: () => void;
  };

  const { sharedLink, onClose }: Props = $props();

  let period: Period = $state('30d');
  let analytics: SharedLinkViewResponseDto | undefined = $state();
  let loading = $state(false);
  let chartElement: HTMLDivElement | undefined = $state();
  let plot: uPlot | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let requestGeneration = 0;

  const renderChart = () => {
    if (!analytics || !chartElement) {
      return;
    }

    const data: AlignedData = [
      analytics.daily.map(({ date }) => DateTime.fromISO(date, { zone: 'utc' }).toSeconds()),
      analytics.daily.map(({ views }) => views),
    ];
    plot?.destroy();
    plot = new uPlot(
      {
        width: chartElement.clientWidth,
        height: 240,
        legend: { show: false },
        cursor: { drag: { setScale: false } },
        scales: { x: { time: true }, y: { range: (_plot, min, max) => [0, Math.max(1, max)] } },
        series: [{}, { label: $t('views'), stroke: '#4250af', width: 2, points: { show: false } }],
        axes: [
          {
            values: (_plot, values) =>
              values.map((value) =>
                DateTime.fromSeconds(value, { zone: 'utc' }).toLocaleString({ month: 'short', day: 'numeric' }),
              ),
          },
          {},
        ],
      },
      data,
      chartElement,
    );
  };

  const load = async (selectedPeriod: Period) => {
    const generation = ++requestGeneration;
    period = selectedPeriod;
    analytics = undefined;
    loading = true;

    try {
      const response = await getSharedLinkViews({ id: sharedLink.id, period });
      if (generation !== requestGeneration) {
        return;
      }

      analytics = response;
      renderChart();
    } catch (error) {
      if (generation === requestGeneration) {
        handleError(error, $t('errors.unable_to_get_shared_link'));
      }
    } finally {
      if (generation === requestGeneration) {
        loading = false;
      }
    }
  };

  onMount(() => {
    void load(period);
    resizeObserver = new ResizeObserver(() => {
      if (plot && chartElement) {
        plot.setSize({ width: chartElement.clientWidth, height: 240 });
      }
    });
    if (chartElement) {
      resizeObserver.observe(chartElement);
    }

    return () => {
      requestGeneration++;
      resizeObserver?.disconnect();
      plot?.destroy();
    };
  });
</script>

<Modal title={$t('shared_link_analytics')} {onClose} size="medium">
  <ModalBody>
    <div class="flex flex-col gap-6">
      <div class="flex gap-2">
        <Button size="small" color={period === '30d' ? 'primary' : 'secondary'} onclick={() => load('30d')}>
          {$t('last_30_days')}
        </Button>
        <Button size="small" color={period === '90d' ? 'primary' : 'secondary'} onclick={() => load('90d')}>
          {$t('last_90_days')}
        </Button>
        <Button size="small" color={period === 'all' ? 'primary' : 'secondary'} onclick={() => load('all')}>
          {$t('all_time')}
        </Button>
      </div>

      {#if analytics}
        <div class="grid grid-cols-2 gap-4">
          <div>
            <Text size="tiny" color="muted">{$t('total_views')}</Text>
            <Text size="large" fontWeight="semi-bold">{analytics.totalViews.toLocaleString()}</Text>
          </div>
          <div>
            <Text size="tiny" color="muted">{$t('unique_browsers')}</Text>
            <Text size="large" fontWeight="semi-bold">{analytics.uniqueBrowsers.toLocaleString()}</Text>
          </div>
        </div>
        <Text size="small" fontWeight="semi-bold">{$t('views_over_time')}</Text>
      {:else if loading}
        <div class="flex h-60 items-center justify-center"><LoadingSpinner size="large" /></div>
      {/if}
      <div class:hidden={!analytics} class="w-full" bind:this={chartElement}></div>
    </div>
  </ModalBody>
</Modal>
