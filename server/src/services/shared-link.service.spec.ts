import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AssetIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { mapSharedLink, SharedLinkViewPeriod } from 'src/dtos/shared-link.dto';
import { SharedLinkType } from 'src/enum';
import { SharedLinkService } from 'src/services/shared-link.service';
import { AlbumFactory } from 'test/factories/album.factory';
import { AssetFactory } from 'test/factories/asset.factory';
import { SharedLinkFactory } from 'test/factories/shared-link.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { sharedLinkStub } from 'test/fixtures/shared-link.stub';
import { getForSharedLink } from 'test/mappers';
import { factory } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

describe(SharedLinkService.name, () => {
  let sut: SharedLinkService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SharedLinkService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getAll', () => {
    it('should return all shared links for a user', async () => {
      const [sharedLink1, sharedLink2] = [SharedLinkFactory.create(), SharedLinkFactory.create()];
      mocks.sharedLink.getAll.mockResolvedValue([getForSharedLink(sharedLink1), getForSharedLink(sharedLink2)]);
      await expect(sut.getAll(authStub.user1, {})).resolves.toEqual(
        [getForSharedLink(sharedLink1), getForSharedLink(sharedLink2)].map((link) =>
          mapSharedLink(link, { stripAssetMetadata: false }),
        ),
      );
      expect(mocks.sharedLink.getAll).toHaveBeenCalledWith({ userId: authStub.user1.user.id });
    });
  });

  describe('trackView', () => {
    it('should hash the visitor ID and atomically track the current shared link', async () => {
      const auth = factory.auth({ sharedLink: { id: 'link-id', password: null } });
      const hash = Buffer.from('visitor-hash');
      mocks.crypto.hashSha256.mockReturnValue(hash);
      mocks.sharedLink.trackView.mockResolvedValue([]);

      await sut.trackView(auth, [], 'visitor-id');

      expect(mocks.crypto.hashSha256).toHaveBeenCalledWith('link-id:visitor-id');
      expect(mocks.sharedLink.trackView).toHaveBeenCalledWith('link-id', hash, expect.any(Date));
    });

    it('should scope the same visitor ID to each shared link', async () => {
      mocks.crypto.hashSha256.mockImplementation((value) => Buffer.from(value));
      mocks.sharedLink.trackView.mockResolvedValue([]);

      await sut.trackView(factory.auth({ sharedLink: { id: 'link-1', password: null } }), [], 'visitor-id');
      await sut.trackView(factory.auth({ sharedLink: { id: 'link-2', password: null } }), [], 'visitor-id');

      expect(mocks.crypto.hashSha256).toHaveBeenNthCalledWith(1, 'link-1:visitor-id');
      expect(mocks.crypto.hashSha256).toHaveBeenNthCalledWith(2, 'link-2:visitor-id');
      expect(mocks.sharedLink.trackView.mock.calls[0][1]).not.toEqual(mocks.sharedLink.trackView.mock.calls[1][1]);
    });

    it('should scope the same visitor ID to the album across album links', async () => {
      mocks.crypto.hashSha256.mockImplementation((value) => Buffer.from(value));
      mocks.sharedLink.trackView.mockResolvedValue([]);

      await sut.trackView(
        factory.auth({ sharedLink: { id: 'link-1', albumId: 'album-1', password: null } }),
        [],
        'visitor-id',
      );
      await sut.trackView(
        factory.auth({ sharedLink: { id: 'link-2', albumId: 'album-1', password: null } }),
        [],
        'visitor-id',
      );
      await sut.trackView(
        factory.auth({ sharedLink: { id: 'link-3', albumId: 'album-2', password: null } }),
        [],
        'visitor-id',
      );

      expect(mocks.crypto.hashSha256).toHaveBeenNthCalledWith(1, 'album-1:visitor-id');
      expect(mocks.crypto.hashSha256).toHaveBeenNthCalledWith(2, 'album-1:visitor-id');
      expect(mocks.crypto.hashSha256).toHaveBeenNthCalledWith(3, 'album-2:visitor-id');
      expect(mocks.sharedLink.trackView.mock.calls[0][1]).toEqual(mocks.sharedLink.trackView.mock.calls[1][1]);
      expect(mocks.sharedLink.trackView.mock.calls[0][1]).not.toEqual(mocks.sharedLink.trackView.mock.calls[2][1]);
    });

    it('should reject a password protected link before login', async () => {
      const auth = factory.auth({ sharedLink: { id: 'link-id', password: 'password' } });
      mocks.crypto.hashSha256.mockReturnValue(Buffer.from('login-token'));

      await expect(sut.trackView(auth, [], 'visitor-id')).rejects.toBeInstanceOf(UnauthorizedException);

      expect(mocks.sharedLink.trackView).not.toHaveBeenCalled();
    });
  });

  describe('getViewAnalytics', () => {
    it('should enforce ownership and fill empty dates for a bounded range', async () => {
      const sharedLink = SharedLinkFactory.create();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.sharedLink.getViewAnalytics.mockResolvedValue({
        totalViews: 2,
        uniqueBrowsers: 1,
        daily: [],
      });

      const result = await sut.getViewAnalytics(authStub.user1, sharedLink.id, SharedLinkViewPeriod.Days30);

      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authStub.user1.user.id, sharedLink.id);
      expect(result.daily).toHaveLength(30);
      expect(result.daily.every(({ views, uniqueBrowsers }) => views === 0 && uniqueBrowsers === 0)).toBe(true);
    });

    it('should reject analytics for a link not owned by the current user', async () => {
      mocks.sharedLink.get.mockResolvedValue(void 0);

      await expect(
        sut.getViewAnalytics(authStub.user1, factory.uuid(), SharedLinkViewPeriod.All),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.sharedLink.getViewAnalytics).not.toHaveBeenCalled();
    });
  });

  describe('getAlbumViewAnalytics', () => {
    it('should return aggregate analytics for an album owner', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
      mocks.sharedLink.getAlbumViewAnalytics.mockResolvedValue({
        totalViews: 5,
        uniqueBrowsers: 2,
        daily: [],
      });

      const result = await sut.getAlbumViewAnalytics(authStub.user1, 'album-id', SharedLinkViewPeriod.All);

      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(authStub.user1.user.id, new Set(['album-id']));
      expect(result).toEqual({ totalViews: 5, uniqueBrowsers: 2, daily: [] });
    });

    it('should reject album analytics for an editor or viewer', async () => {
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(
        sut.getAlbumViewAnalytics(authStub.user1, 'album-id', SharedLinkViewPeriod.All),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mocks.sharedLink.getAlbumViewAnalytics).not.toHaveBeenCalled();
    });
  });

  describe('getMine', () => {
    it('should only work for a public user', async () => {
      await expect(sut.getMine(authStub.admin, [])).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.sharedLink.get).not.toHaveBeenCalled();
    });

    it('should return the shared link for the public user', async () => {
      const authDto = authStub.adminSharedLink;
      const sharedLink = SharedLinkFactory.create();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));
      await expect(sut.getMine(authDto, [])).resolves.toEqual(
        mapSharedLink(getForSharedLink(sharedLink), { stripAssetMetadata: false }),
      );
      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authDto.user.id, authDto.sharedLink?.id);
    });

    it('should not return metadata', async () => {
      const authDto = factory.auth({
        sharedLink: {
          showExif: false,
          allowDownload: true,
          allowUpload: true,
        },
      });
      mocks.sharedLink.get.mockResolvedValue(
        getForSharedLink(
          SharedLinkFactory.from({ showExif: false })
            .asset({}, (builder) => builder.exif())
            .build(),
        ),
      );
      const response = await sut.getMine(authDto, []);
      expect(response.assets[0]).toMatchObject({ hasMetadata: false });
      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authDto.user.id, authDto.sharedLink?.id);
    });

    it('should throw an error for a request without a shared link auth token', async () => {
      const authDto = authStub.adminSharedLink;
      mocks.sharedLink.get.mockResolvedValue(sharedLinkStub.passwordRequired);
      await expect(sut.getMine(authDto, [])).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authDto.user.id, authDto.sharedLink?.id);
    });

    it('should accept a valid shared link auth token', async () => {
      const sharedLink = SharedLinkFactory.create({ password: '123' });
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));
      const secret = Buffer.from('auth-token-123');
      mocks.crypto.hashSha256.mockReturnValue(secret);
      await expect(sut.getMine(authStub.adminSharedLink, [secret.toString('base64')])).resolves.toBeDefined();
      expect(mocks.sharedLink.get).toHaveBeenCalledWith(
        authStub.adminSharedLink.user.id,
        authStub.adminSharedLink.sharedLink?.id,
      );
    });
  });

  describe('get', () => {
    it('should throw an error for an invalid shared link', async () => {
      mocks.sharedLink.get.mockResolvedValue(void 0);

      await expect(sut.get(authStub.user1, 'missing-id')).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authStub.user1.user.id, 'missing-id');
      expect(mocks.sharedLink.update).not.toHaveBeenCalled();
    });

    it('should get a shared link by id', async () => {
      const sharedLink = SharedLinkFactory.create();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));
      await expect(sut.get(authStub.user1, sharedLink.id)).resolves.toEqual(
        mapSharedLink(getForSharedLink(sharedLink), { stripAssetMetadata: true }),
      );
      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authStub.user1.user.id, sharedLink.id);
    });
  });

  describe('create', () => {
    it('should not allow an album shared link without an albumId', async () => {
      await expect(sut.create(authStub.admin, { type: SharedLinkType.Album, assetIds: [] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should not allow non-owners to create album shared links', async () => {
      await expect(
        sut.create(authStub.admin, { type: SharedLinkType.Album, assetIds: [], albumId: 'album-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should not allow individual shared links with no assets', async () => {
      await expect(
        sut.create(authStub.admin, { type: SharedLinkType.Individual, assetIds: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should require asset ownership to make an individual shared link', async () => {
      await expect(
        sut.create(authStub.admin, { type: SharedLinkType.Individual, assetIds: ['asset-1'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('should create an album shared link', async () => {
      const album = AlbumFactory.from().asset().build();
      const sharedLink = SharedLinkFactory.from().album(album).build();
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.sharedLink.create.mockResolvedValue(getForSharedLink(sharedLink));

      await sut.create(authStub.admin, { type: SharedLinkType.Album, albumId: album.id });

      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(authStub.admin.user.id, new Set([album.id]));
      expect(mocks.sharedLink.create).toHaveBeenCalledWith({
        type: SharedLinkType.Album,
        userId: authStub.admin.user.id,
        albumId: album.id,
        allowDownload: true,
        allowUpload: true,
        description: null,
        expiresAt: null,
        slug: null,
        showExif: true,
        key: Buffer.from('random-bytes', 'utf8'),
      });
    });

    it('should create an individual shared link', async () => {
      const asset = AssetFactory.create();
      const sharedLink = SharedLinkFactory.from()
        .asset(asset, (builder) => builder.exif())
        .build();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.sharedLink.create.mockResolvedValue(getForSharedLink(sharedLink));

      await sut.create(authStub.admin, {
        type: SharedLinkType.Individual,
        assetIds: [asset.id],
        showMetadata: true,
        allowDownload: true,
        allowUpload: true,
      });

      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(
        authStub.admin.user.id,
        new Set([asset.id]),
        false,
      );
      expect(mocks.sharedLink.create).toHaveBeenCalledWith({
        type: SharedLinkType.Individual,
        userId: authStub.admin.user.id,
        albumId: null,
        allowDownload: true,
        slug: null,
        allowUpload: true,
        assetIds: [asset.id],
        description: null,
        expiresAt: null,
        showExif: true,
        key: Buffer.from('random-bytes', 'utf8'),
      });
    });

    it('should create a shared link with allowDownload set to false when showMetadata is false', async () => {
      const asset = AssetFactory.create();
      const sharedLink = SharedLinkFactory.from({ allowDownload: false })
        .asset(asset, (builder) => builder.exif())
        .build();
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.sharedLink.create.mockResolvedValue(getForSharedLink(sharedLink));

      await sut.create(authStub.admin, {
        type: SharedLinkType.Individual,
        assetIds: [asset.id],
        showMetadata: false,
        allowDownload: true,
        allowUpload: true,
      });

      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(
        authStub.admin.user.id,
        new Set([asset.id]),
        false,
      );
      expect(mocks.sharedLink.create).toHaveBeenCalledWith({
        type: SharedLinkType.Individual,
        userId: authStub.admin.user.id,
        albumId: null,
        allowDownload: false,
        allowUpload: true,
        assetIds: [asset.id],
        description: null,
        expiresAt: null,
        showExif: false,
        slug: null,
        key: Buffer.from('random-bytes', 'utf8'),
      });
    });
  });

  describe('update', () => {
    it('should throw an error for an invalid shared link', async () => {
      mocks.sharedLink.get.mockResolvedValue(void 0);

      await expect(sut.update(authStub.user1, 'missing-id', {})).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authStub.user1.user.id, 'missing-id');
      expect(mocks.sharedLink.update).not.toHaveBeenCalled();
    });

    it('should update a shared link', async () => {
      const sharedLink = SharedLinkFactory.create();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.sharedLink.update.mockResolvedValue(getForSharedLink(sharedLink));

      await sut.update(authStub.user1, sharedLinkStub.valid.id, { allowDownload: false });

      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authStub.user1.user.id, sharedLinkStub.valid.id);
      expect(mocks.sharedLink.update).toHaveBeenCalledWith({
        id: sharedLinkStub.valid.id,
        slug: null,
        userId: authStub.user1.user.id,
        allowDownload: false,
      });
    });
  });

  describe('remove', () => {
    it('should throw an error for an invalid shared link', async () => {
      mocks.sharedLink.get.mockResolvedValue(void 0);

      await expect(sut.remove(authStub.user1, 'missing-id')).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authStub.user1.user.id, 'missing-id');
      expect(mocks.sharedLink.update).not.toHaveBeenCalled();
    });

    it('should remove a key', async () => {
      const sharedLink = SharedLinkFactory.create();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.sharedLink.remove.mockResolvedValue();

      await sut.remove(authStub.user1, sharedLink.id);

      expect(mocks.sharedLink.get).toHaveBeenCalledWith(authStub.user1.user.id, sharedLink.id);
      expect(mocks.sharedLink.remove).toHaveBeenCalledWith(sharedLink.id);
    });
  });

  describe('addAssets', () => {
    it('should not work on album shared links', async () => {
      const sharedLink = SharedLinkFactory.from().album().build();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));

      await expect(sut.addAssets(authStub.admin, 'link-1', { assetIds: ['asset-1'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should add assets to a shared link', async () => {
      const asset = AssetFactory.create();
      const sharedLink = SharedLinkFactory.from()
        .asset(asset, (builder) => builder.exif())
        .build();
      const newAsset = AssetFactory.create();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.sharedLink.create.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.sharedLink.update.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([newAsset.id]));

      await expect(
        sut.addAssets(authStub.admin, sharedLink.id, { assetIds: [asset.id, 'asset-2', newAsset.id] }),
      ).resolves.toEqual([
        { assetId: asset.id, success: false, error: AssetIdErrorReason.DUPLICATE },
        { assetId: 'asset-2', success: false, error: AssetIdErrorReason.NO_PERMISSION },
        { assetId: newAsset.id, success: true },
      ]);

      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledTimes(1);
      expect(mocks.sharedLink.update).toHaveBeenCalled();
      expect(mocks.sharedLink.update).toHaveBeenCalledWith({
        ...getForSharedLink(sharedLink),
        slug: null,
        assetIds: [newAsset.id],
      });
    });
  });

  describe('removeAssets', () => {
    it('should not work on album shared links', async () => {
      const sharedLink = SharedLinkFactory.from().album().build();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));

      await expect(sut.removeAssets(authStub.admin, sharedLink.id, { assetIds: ['asset-1'] })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should remove assets from a shared link', async () => {
      const asset = AssetFactory.create();
      const sharedLink = SharedLinkFactory.from()
        .asset(asset, (builder) => builder.exif())
        .build();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.sharedLink.create.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.sharedLink.update.mockResolvedValue(getForSharedLink(sharedLink));
      mocks.sharedLinkAsset.remove.mockResolvedValue([asset.id]);

      await expect(
        sut.removeAssets(authStub.admin, sharedLink.id, { assetIds: [asset.id, 'asset-2'] }),
      ).resolves.toEqual([
        { assetId: asset.id, success: true },
        { assetId: 'asset-2', success: false, error: AssetIdErrorReason.NOT_FOUND },
      ]);

      expect(mocks.sharedLinkAsset.remove).toHaveBeenCalledWith(sharedLink.id, [asset.id, 'asset-2']);
      expect(mocks.sharedLink.update).toHaveBeenCalledWith(expect.objectContaining({ assets: [] }));
    });
  });

  describe('getMetadataTags', () => {
    it('should return null when auth is not a shared link', async () => {
      await expect(sut.getMetadataTags(authStub.admin)).resolves.toBe(null);

      expect(mocks.sharedLink.get).not.toHaveBeenCalled();
    });

    it('should return null when shared link has a password', async () => {
      const auth = factory.auth({ user: {}, sharedLink: { password: 'password' } });

      await expect(sut.getMetadataTags(auth)).resolves.toBe(null);

      expect(mocks.sharedLink.get).not.toHaveBeenCalled();
    });

    it('should return metadata tags', async () => {
      const sharedLink = SharedLinkFactory.from({ description: null })
        .asset({}, (builder) => builder.exif())
        .build();
      mocks.sharedLink.get.mockResolvedValue(getForSharedLink(sharedLink));

      await expect(sut.getMetadataTags(authStub.adminSharedLink)).resolves.toEqual({
        description: '1 shared photos & videos',
        imageUrl: `https://my.immich.app/api/assets/${sharedLink.assets[0].id}/thumbnail?key=${sharedLink.key.toString('base64url')}`,
        title: 'Public Share',
      });

      expect(mocks.sharedLink.get).toHaveBeenCalled();
    });

    it('should return metadata tags with a default image path if the asset id is not set', async () => {
      mocks.sharedLink.get.mockResolvedValue({ ...sharedLinkStub.individual, album: null, assets: [] });
      await expect(sut.getMetadataTags(authStub.adminSharedLink)).resolves.toEqual({
        description: '0 shared photos & videos',
        imageUrl: `https://my.immich.app/feature-panel.png`,
        title: 'Public Share',
      });

      expect(mocks.sharedLink.get).toHaveBeenCalled();
    });
  });
});
