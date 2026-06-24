import { Kysely } from 'kysely';
import { AssetType } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { MapRepository } from 'src/repositories/map.repository';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository';
import { TagRepository } from 'src/repositories/tag.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

describe(MapRepository.name, () => {
  let database: Kysely<DB>;

  beforeAll(async () => {
    database = await getKyselyDB();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('should filter map markers by asset content', async () => {
    const { ctx } = newMediumService(BaseService, {
      database,
      real: [],
      mock: [LoggingRepository],
    });
    const repository = new MapRepository(
      new ConfigRepository(),
      new SystemMetadataRepository(database),
      LoggingRepository.create(),
      database as never,
    );
    const { user } = await ctx.newUser();
    const { person: firstPerson } = await ctx.newPerson({ ownerId: user.id });
    const { person: secondPerson } = await ctx.newPerson({ ownerId: user.id });
    const firstTag = await ctx.get(TagRepository).upsertValue({ userId: user.id, value: 'first' });
    const secondTag = await ctx.get(TagRepository).upsertValue({ userId: user.id, value: 'second' });
    const { asset: matchingAsset } = await ctx.newAsset({
      ownerId: user.id,
      type: AssetType.Image,
      isFavorite: true,
      fileCreatedAt: new Date('2024-06-15T12:00:00.000Z'),
    });
    const { asset: videoAsset } = await ctx.newAsset({
      ownerId: user.id,
      type: AssetType.Video,
      fileCreatedAt: new Date('2023-06-15T12:00:00.000Z'),
    });
    const { asset: unratedAsset } = await ctx.newAsset({
      ownerId: user.id,
      type: AssetType.Image,
      fileCreatedAt: new Date('2024-07-15T12:00:00.000Z'),
    });

    await Promise.all([
      ctx.newExif({
        assetId: matchingAsset.id,
        latitude: 48.8566,
        longitude: 2.3522,
        make: 'Canon',
        model: 'EOS R5',
        lensModel: 'RF24-70mm',
        rating: 5,
      }),
      ctx.newExif({
        assetId: videoAsset.id,
        latitude: 40.7128,
        longitude: -74.006,
        make: 'Sony',
        model: 'A7S III',
        lensModel: 'FE24-70mm',
        rating: 3,
      }),
      ctx.newExif({
        assetId: unratedAsset.id,
        latitude: 35.6762,
        longitude: 139.6503,
        make: 'Canon',
        model: 'EOS R5',
        lensModel: 'RF24-70mm',
        rating: null,
      }),
      ctx.newAssetFace({ assetId: matchingAsset.id, personId: firstPerson.id }),
      ctx.newAssetFace({ assetId: matchingAsset.id, personId: secondPerson.id }),
      ctx.newAssetFace({ assetId: videoAsset.id, personId: secondPerson.id }),
      ctx.newTagAsset({ tagIds: [firstTag.id], assetIds: [matchingAsset.id] }),
      ctx.newTagAsset({ tagIds: [secondTag.id], assetIds: [videoAsset.id] }),
    ]);

    const getIds = async (filters: Parameters<MapRepository['getMapMarkers']>[3]) => {
      const markers = await repository.getMapMarkers(user.id, [user.id], [], filters);
      return new Set(markers.map(({ id }) => id));
    };

    await expect(
      getIds({
        personIds: [firstPerson.id],
        tagIds: [firstTag.id],
        make: 'Canon',
        model: 'EOS R5',
        lensModel: 'RF24-70mm',
        rating: 4,
        type: AssetType.Image,
        takenAfter: new Date('2024-01-01T00:00:00.000Z'),
        takenBefore: new Date('2024-12-31T23:59:59.999Z'),
        isFavorite: true,
      }),
    ).resolves.toEqual(new Set([matchingAsset.id]));
    await expect(getIds({ personIds: [firstPerson.id, secondPerson.id] })).resolves.toEqual(
      new Set([matchingAsset.id]),
    );
    await expect(getIds({ personIds: [firstPerson.id, firstPerson.id] })).resolves.toEqual(new Set([matchingAsset.id]));
    await expect(getIds({ tagIds: [firstTag.id, secondTag.id] })).resolves.toEqual(
      new Set([matchingAsset.id, videoAsset.id]),
    );
    await expect(getIds({ rating: 4 })).resolves.toEqual(new Set([matchingAsset.id]));
    await expect(getIds({ isUnrated: true })).resolves.toEqual(new Set([unratedAsset.id]));
    await expect(getIds({ type: AssetType.Video })).resolves.toEqual(new Set([videoAsset.id]));
  });
});
