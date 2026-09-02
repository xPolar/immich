import { BadRequestException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { SharedLinkType } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { StackRepository } from 'src/repositories/stack.repository';
import { DB } from 'src/schema';
import { StackService } from 'src/services/stack.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(StackService, {
    database: db || defaultDatabase,
    real: [AccessRepository, StackRepository],
    mock: [LoggingRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(StackService.name, () => {
  it('should return a stack through a shared album when one of its assets is in the album', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    const { asset: jpeg } = await ctx.newAsset({ ownerId: user.id, originalFileName: 'photo.jpg' });
    const { asset: raw } = await ctx.newAsset({ ownerId: user.id, originalFileName: 'photo.raw' });
    const { asset: unrelated } = await ctx.newAsset({ ownerId: user.id });
    await Promise.all([
      ctx.newExif({ assetId: jpeg.id, make: 'Canon' }),
      ctx.newExif({ assetId: raw.id, make: 'Canon' }),
      ctx.newExif({ assetId: unrelated.id, make: 'Canon' }),
    ]);
    const { stack } = await ctx.newStack({ ownerId: user.id }, [jpeg.id, raw.id]);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: jpeg.id });
    const sharedLink = await ctx.get(SharedLinkRepository).create({
      allowUpload: false,
      key: Buffer.from('public-album-stack'),
      type: SharedLinkType.Album,
      userId: user.id,
      albumId: album.id,
    });
    const auth = factory.auth({
      user: { id: user.id },
      sharedLink: { id: sharedLink.id, albumId: album.id, userId: user.id },
    });

    await expect(sut.get(auth, stack.id)).resolves.toEqual(
      expect.objectContaining({
        id: stack.id,
        primaryAssetId: jpeg.id,
        assets: [expect.objectContaining({ id: jpeg.id }), expect.objectContaining({ id: raw.id })],
      }),
    );
    await expect(
      ctx.get(AccessRepository).asset.checkSharedLinkAccess(sharedLink.id, new Set([raw.id, unrelated.id])),
    ).resolves.toEqual(new Set([raw.id]));

    const unrelatedSharedLink = await ctx.get(SharedLinkRepository).create({
      allowUpload: false,
      key: Buffer.from('unrelated-public-link'),
      type: SharedLinkType.Individual,
      userId: user.id,
      assetIds: [jpeg.id],
    });
    const unrelatedAuth = factory.auth({
      user: { id: user.id },
      sharedLink: { id: unrelatedSharedLink.id, userId: user.id },
    });

    await expect(sut.get(unrelatedAuth, stack.id)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctx.get(AccessRepository).asset.checkSharedLinkAccess(unrelatedSharedLink.id, new Set([raw.id])),
    ).resolves.toEqual(new Set());
  });

  it('should strip stack asset metadata when the shared album hides metadata', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    const { asset: jpeg } = await ctx.newAsset({ ownerId: user.id, originalFileName: 'photo.jpg' });
    const { asset: raw } = await ctx.newAsset({ ownerId: user.id, originalFileName: 'photo.raw' });
    await Promise.all([
      ctx.newExif({ assetId: jpeg.id, make: 'Canon' }),
      ctx.newExif({ assetId: raw.id, make: 'Canon' }),
    ]);
    const { stack } = await ctx.newStack({ ownerId: user.id }, [jpeg.id, raw.id]);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: jpeg.id });
    const sharedLink = await ctx.get(SharedLinkRepository).create({
      allowUpload: false,
      key: Buffer.from('private-metadata-stack'),
      type: SharedLinkType.Album,
      userId: user.id,
      albumId: album.id,
      showExif: false,
    });
    const auth = factory.auth({
      user: { id: user.id },
      sharedLink: { id: sharedLink.id, albumId: album.id, userId: user.id, showExif: false },
    });

    const response = await sut.get(auth, stack.id);

    expect(response.assets).toEqual([
      expect.objectContaining({ id: jpeg.id, hasMetadata: false }),
      expect.objectContaining({ id: raw.id, hasMetadata: false }),
    ]);
    expect(response.assets[0]).not.toHaveProperty('originalFileName');
    expect(response.assets[1]).not.toHaveProperty('originalFileName');
  });
});
