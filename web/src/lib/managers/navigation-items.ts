import type { ServerFeaturesDto } from '@immich/sdk';
import {
  mdiAccountMultipleOutline,
  mdiArchive,
  mdiBookshelf,
  mdiCog,
  mdiHeart,
  mdiHistory,
  mdiImageMultiple,
  mdiMap,
  mdiShareVariantOutline,
  mdiSync,
  mdiTagMultipleOutline,
  mdiTrashCanOutline,
  mdiViewAgenda,
} from '@mdi/js';
import { Route } from '$lib/route';
import { isAlmostExactWordMatch } from './cmdk-match';

export type NavigationItem = {
  id: `nav:${string}`;
  labelKey: string;
  descriptionKey?: string;
  icon: string;
  route: string;
  adminOnly?: boolean;
  featureFlag?: keyof ServerFeaturesDto;
  category: 'user' | 'admin' | 'system';
};

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { id: 'nav:photos', labelKey: 'photos', icon: mdiImageMultiple, route: Route.photos(), category: 'user' },
  { id: 'nav:albums', labelKey: 'albums', icon: mdiViewAgenda, route: Route.albums(), category: 'user' },
  { id: 'nav:people', labelKey: 'people', icon: mdiAccountMultipleOutline, route: Route.people(), category: 'user' },
  { id: 'nav:tags', labelKey: 'tags', icon: mdiTagMultipleOutline, route: Route.tags(), category: 'user' },
  { id: 'nav:map', labelKey: 'map', icon: mdiMap, route: Route.map(), featureFlag: 'map', category: 'user' },
  { id: 'nav:sharing', labelKey: 'sharing', icon: mdiShareVariantOutline, route: Route.sharing(), category: 'user' },
  { id: 'nav:favorites', labelKey: 'favorites', icon: mdiHeart, route: Route.favorites(), category: 'user' },
  { id: 'nav:archive', labelKey: 'archive', icon: mdiArchive, route: Route.archive(), category: 'user' },
  { id: 'nav:memories', labelKey: 'memories', icon: mdiHistory, route: Route.memories(), category: 'user' },
  {
    id: 'nav:trash',
    labelKey: 'trash',
    icon: mdiTrashCanOutline,
    route: Route.trash(),
    featureFlag: 'trash',
    category: 'user',
  },
  {
    id: 'nav:admin-users',
    labelKey: 'users',
    icon: mdiAccountMultipleOutline,
    route: Route.users(),
    adminOnly: true,
    category: 'admin',
  },
  {
    id: 'nav:admin-libraries',
    labelKey: 'external_libraries',
    icon: mdiBookshelf,
    route: Route.libraries(),
    adminOnly: true,
    category: 'admin',
  },
  {
    id: 'nav:admin-jobs',
    labelKey: 'jobs',
    icon: mdiSync,
    route: Route.queues(),
    adminOnly: true,
    category: 'admin',
  },
  {
    id: 'nav:admin-settings',
    labelKey: 'administration',
    icon: mdiCog,
    route: Route.systemSettings(),
    adminOnly: true,
    category: 'admin',
  },
  ...[
    ['authentication', 'authentication_settings'],
    ['backup', 'backup_settings'],
    ['image', 'image_settings'],
    ['job', 'job_settings'],
    ['external-library', 'library_settings'],
    ['logging', 'logging_settings'],
    ['machine-learning', 'machine_learning_settings'],
    ['location', 'map_gps_settings'],
    ['metadata', 'metadata_settings'],
    ['nightly-tasks', 'nightly_tasks_settings'],
    ['notifications', 'notification_settings'],
    ['server', 'server_settings'],
    ['storage-template', 'storage_template_settings'],
    ['theme', 'theme_settings'],
    ['trash', 'trash_settings'],
    ['user-settings', 'user_settings'],
    ['version-check', 'version_check_settings'],
    ['video-transcoding', 'transcoding_settings'],
  ].map(
    ([key, labelKey]): NavigationItem => ({
      id: `nav:system-${key}`,
      labelKey: `admin.${labelKey}`,
      icon: mdiCog,
      route: Route.systemSettings({ isOpen: key as never }),
      adminOnly: true,
      category: 'system',
    }),
  ),
];

export const isAlmostExactNavigationMatch = (query: string, label: string) => isAlmostExactWordMatch(query, label);
