<script lang="ts">
  import SettingInputField from '$lib/components/shared-components/settings/SettingInputField.svelte';
  import SettingButtonsRow from '$lib/components/shared-components/settings/SystemConfigButtonRow.svelte';
  import SettingSwitch from '$lib/components/shared-components/settings/SettingSwitch.svelte';
  import { SettingInputFieldType } from '$lib/constants';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { t } from 'svelte-i18n';
  import { fade } from 'svelte/transition';

  const disabled = $derived(featureFlagsManager.value.configFile);
  const config = $derived(systemConfigManager.value);
  let configToEdit = $state(systemConfigManager.cloneValue());
</script>

<div class="mt-2">
  <div in:fade={{ duration: 500 }}>
    <form autocomplete="off" class="mx-4 mt-4" onsubmit={(event) => event.preventDefault()}>
      <div class="ms-4 mt-4 flex flex-col gap-4">
        <SettingSwitch
          title={$t('admin.metadata_faces_import_setting')}
          subtitle={$t('admin.metadata_faces_import_setting_description')}
          bind:checked={configToEdit.metadata.faces.import}
          {disabled}
        />

        <hr />

        <SettingSwitch
          title={$t('admin.metadata_dawarich_geotagging_setting')}
          subtitle={$t('admin.metadata_dawarich_geotagging_setting_description')}
          bind:checked={configToEdit.metadata.dawarich.enabled}
          {disabled}
        />

        <SettingInputField
          inputType={SettingInputFieldType.TEXT}
          label={$t('admin.metadata_dawarich_url')}
          description={$t('admin.metadata_dawarich_url_description')}
          bind:value={configToEdit.metadata.dawarich.url}
          disabled={disabled || !configToEdit.metadata.dawarich.enabled}
          isEdited={configToEdit.metadata.dawarich.url !== config.metadata.dawarich.url}
        />

        <SettingInputField
          inputType={SettingInputFieldType.PASSWORD}
          label={$t('admin.metadata_dawarich_api_key')}
          description={$t('admin.metadata_dawarich_api_key_description')}
          bind:value={configToEdit.metadata.dawarich.apiKey}
          disabled={disabled || !configToEdit.metadata.dawarich.enabled}
          isEdited={configToEdit.metadata.dawarich.apiKey !== config.metadata.dawarich.apiKey}
        />

        <SettingInputField
          inputType={SettingInputFieldType.NUMBER}
          label={$t('admin.metadata_dawarich_match_window')}
          description={$t('admin.metadata_dawarich_match_window_description')}
          bind:value={configToEdit.metadata.dawarich.matchWindowMinutes}
          disabled={disabled || !configToEdit.metadata.dawarich.enabled}
          min={1}
          max={1440}
          integer
          isEdited={configToEdit.metadata.dawarich.matchWindowMinutes !== config.metadata.dawarich.matchWindowMinutes}
        />
      </div>

      <SettingButtonsRow bind:configToEdit keys={['metadata']} {disabled} />
    </form>
  </div>
</div>
