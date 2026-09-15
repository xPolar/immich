<script lang="ts">
  import { goto } from '$app/navigation';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import AssetChangeDateModal from '$lib/modals/AssetChangeDateModal.svelte';
  import { Route } from '$lib/route';
  import { locale } from '$lib/stores/preferences.store';
  import { navigate } from '$lib/utils/navigation';
  import { fromISODateTime, fromISODateTimeUTC, toTimelineAsset } from '$lib/utils/timeline-util';
  import { type AssetResponseDto } from '@immich/sdk';
  import { Icon, modalManager } from '@immich/ui';
  import { mdiCalendar, mdiPencil } from '@mdi/js';
  import { t } from 'svelte-i18n';

  type Props = {
    asset: AssetResponseDto;
  };

  const { asset }: Props = $props();

  const timeZone = $derived(asset.exifInfo?.timeZone ?? undefined);
  const dateTime = $derived(
    timeZone && asset.exifInfo?.dateTimeOriginal
      ? fromISODateTime(asset.exifInfo.dateTimeOriginal, timeZone)
      : fromISODateTimeUTC(asset.localDateTime),
  );
  const isOwner = $derived(authManager.authenticated && asset.ownerId === authManager.user.id);

  const handleViewDate = async (event: MouseEvent) => {
    const at = dateTime.toISODate();
    if (!at) {
      return;
    }

    if (event.shiftKey) {
      await goto(Route.photos({ at }));
      return;
    }

    await navigate({ targetRoute: 'current', assetId: null, assetGridRouteSearchParams: { at } });
  };

  const handleChangeDate = async () => {
    if (!isOwner) {
      return;
    }

    await modalManager.show(AssetChangeDateModal, {
      asset: toTimelineAsset(asset),
      initialDate: dateTime,
      initialTimeZone: timeZone,
    });
  };
</script>

{#if dateTime}
  <div class="flex w-full place-items-start justify-between gap-4 py-4">
    <button
      type="button"
      class="flex flex-1 gap-4 text-start hover:text-primary"
      onclick={handleViewDate}
      title={$t('view_in_timeline')}
      data-testid="detail-panel-view-date-button"
    >
      <Icon icon={mdiCalendar} size="24" />

      <div>
        <p>
          {dateTime.toLocaleString({ month: 'short', day: 'numeric', year: 'numeric' }, { locale: $locale })}
        </p>
        <div class="flex gap-2 text-sm">
          <p>
            {dateTime.toLocaleString(
              {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: timeZone ? 'longOffset' : undefined,
              },
              { locale: $locale },
            )}
          </p>
        </div>
      </div>
    </button>

    {#if isOwner}
      <button
        type="button"
        class="p-1 hover:text-primary"
        onclick={handleChangeDate}
        title={$t('edit_date')}
        aria-label={$t('edit_date')}
        data-testid="detail-panel-edit-date-button"
      >
        <Icon icon={mdiPencil} size="20" />
      </button>
    {/if}
  </div>
{:else if !dateTime && isOwner}
  <div class="flex place-items-start justify-between gap-4 py-4">
    <div class="flex gap-4">
      <Icon icon={mdiCalendar} size="24" />
    </div>
    <div class="p-1">
      <Icon icon={mdiPencil} size="20" />
    </div>
  </div>
{/if}
