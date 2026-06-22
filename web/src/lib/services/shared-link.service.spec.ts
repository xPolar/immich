import type { ServerConfigDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import { asUrl, getSharedLinkActions, shouldTrackSharedLinkView } from '$lib/services/shared-link.service';
import { sharedLinkFactory } from '@test-data/factories/shared-link-factory';

vi.mock(import('$lib/managers/server-config-manager.svelte'), () => ({
  serverConfigManager: {
    value: { externalDomain: 'http://localhost:2283' } as ServerConfigDto,
    init: vi.fn(),
    loadServerConfig: vi.fn(),
  },
}));

describe('SharedLinkService', () => {
  describe('asUrl', () => {
    it('should properly encode characters in slug', () => {
      expect(asUrl(sharedLinkFactory.build({ slug: 'foo/bar' }))).toBe('http://localhost:2283/s/foo%2Fbar');
    });
  });

  describe('shouldTrackSharedLinkView', () => {
    it('should not track while the password prompt is shown', () => {
      expect(shouldTrackSharedLinkView({ authenticated: false, ownerId: 'owner', passwordRequired: true })).toBe(false);
    });

    it('should track an anonymous browser after password login', () => {
      expect(shouldTrackSharedLinkView({ authenticated: false, ownerId: 'owner', passwordRequired: false })).toBe(true);
    });

    it('should not track the authenticated owner', () => {
      expect(
        shouldTrackSharedLinkView({
          authenticated: true,
          userId: 'owner',
          ownerId: 'owner',
          passwordRequired: false,
        }),
      ).toBe(false);
    });
  });

  it('should expose analytics from the shared link actions', () => {
    const formatter = ((key: string) => key) as MessageFormatter;
    const { Analytics } = getSharedLinkActions(formatter, sharedLinkFactory.build());

    expect(Analytics.title).toBe('analytics');
    expect(Analytics.onAction).toBeTypeOf('function');
  });
});
