import { modalManager, themeManager, toastManager } from '@immich/ui';
import {
  mdiCloudUploadOutline,
  mdiKeyboardOutline,
  mdiLogoutVariant,
  mdiPlaylistPlus,
  mdiRestore,
  mdiThemeLightDark,
} from '@mdi/js';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { authManager } from '$lib/managers/auth-manager.svelte';
import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
import { clearGlobalSearchRecents } from '$lib/stores/cmdk-recent';
import { createAlbumAndRedirect } from '$lib/utils/album-utils';
import { openFileUploadDialog } from '$lib/utils/file-uploader';
import { isAlmostExactWordMatch } from './cmdk-match';

export type CommandItem = {
  id: `cmd:${string}`;
  labelKey: string;
  icon: string;
  run: () => void | Promise<unknown>;
};

export const COMMAND_ITEMS: readonly CommandItem[] = [
  { id: 'cmd:upload', labelKey: 'upload', icon: mdiCloudUploadOutline, run: () => openFileUploadDialog() },
  {
    id: 'cmd:new-album',
    labelKey: 'new_album',
    icon: mdiPlaylistPlus,
    run: () => createAlbumAndRedirect(),
  },
  { id: 'cmd:theme', labelKey: 'theme', icon: mdiThemeLightDark, run: () => themeManager.toggle() },
  {
    id: 'cmd:shortcuts',
    labelKey: 'keyboard_shortcuts',
    icon: mdiKeyboardOutline,
    run: () => modalManager.show(ShortcutsModal, {}),
  },
  {
    id: 'cmd:sign-out',
    labelKey: 'sign_out',
    icon: mdiLogoutVariant,
    run: () => {
      toastManager.info(get(t)('signing_out' as never));
      return authManager.logout();
    },
  },
  {
    id: 'cmd:clear-recents',
    labelKey: 'clear',
    icon: mdiRestore,
    run: () => clearGlobalSearchRecents(),
  },
];

export const isAlmostExactCommandMatch = (query: string, label: string) => isAlmostExactWordMatch(query, label);
