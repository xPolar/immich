import { Kysely } from 'kysely';
import { SearchSuggestionType } from 'src/dtos/search.dto';
import { AccessRepository } from 'src/repositories/access.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LibraryRepository } from 'src/repositories/library.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { DB } from 'src/schema';
import { SearchService } from 'src/services/search.service';
import { newMediumService } from 'test/medium.factory';
import { factory, newEmbedding } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(SearchService, {
    database: db || defaultDatabase,
    real: [
      AccessRepository,
      AssetRepository,
      DatabaseRepository,
      SearchRepository,
      PartnerRepository,
      PersonRepository,
    ],
    mock: [LoggingRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SearchService.name, () => {
  describe('getSearchLibraries', () => {
    it('should include own and timeline partner libraries, excluding other users and deleted libraries', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: partner } = await ctx.newUser();
      const { user: hiddenPartner } = await ctx.newUser();
      const { user: reversePartner } = await ctx.newUser();
      const { user: unrelated } = await ctx.newUser();
      await ctx.newPartner({ sharedById: partner.id, sharedWithId: user.id });
      await ctx.newPartner({ sharedById: hiddenPartner.id, sharedWithId: user.id, inTimeline: false });
      await ctx.newPartner({ sharedById: user.id, sharedWithId: reversePartner.id });

      const repository = new LibraryRepository(defaultDatabase);
      const libraries = [];
      for (const owner of [user, partner, hiddenPartner, reversePartner, unrelated]) {
        libraries.push(
          await repository.create({ ownerId: owner.id, name: 'Photos', importPaths: [], exclusionPatterns: [] }),
        );
      }
      const deleted = await repository.create({
        ownerId: user.id,
        name: 'Deleted',
        importPaths: [],
        exclusionPatterns: [],
      });
      await repository.softDelete(deleted.id);

      const result = await sut.getSearchLibraries(factory.auth({ user: { id: user.id } }));

      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining(libraries.slice(0, 2).map(({ id, name }) => ({ id, name }))));
      await expect(ctx.get(SearchRepository).getLibraries([])).resolves.toEqual([]);
    });
  });

  describe.each(['metadata', 'smart'])('%s library filtering', (type) => {
    it('should distinguish all libraries, one library, and uploads while retaining owner scoping', async () => {
      const { ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const library = await new LibraryRepository(defaultDatabase).create({
        ownerId: user.id,
        name: 'Apple Photos',
        importPaths: [],
        exclusionPatterns: [],
      });
      const secondLibrary = await new LibraryRepository(defaultDatabase).create({
        ownerId: user.id,
        name: 'DAS',
        importPaths: [],
        exclusionPatterns: [],
      });
      const { asset: external } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
      const { asset: secondExternal } = await ctx.newAsset({ ownerId: user.id, libraryId: secondLibrary.id });
      const { asset: upload } = await ctx.newAsset({ ownerId: user.id });
      const { asset: otherUpload } = await ctx.newAsset({ ownerId: other.id });
      const otherLibrary = await new LibraryRepository(defaultDatabase).create({
        ownerId: other.id,
        name: 'Other photos',
        importPaths: [],
        exclusionPatterns: [],
      });
      const { asset: otherExternal } = await ctx.newAsset({ ownerId: other.id, libraryId: otherLibrary.id });
      const repository = ctx.get(SearchRepository);
      const embedding = newEmbedding();
      for (const asset of [external, secondExternal, upload, otherUpload, otherExternal]) {
        await repository.upsert(asset.id, embedding);
      }

      for (const [libraryId, expected] of [
        [undefined, [external.id, secondExternal.id, upload.id]],
        [library.id, [external.id]],
        [secondLibrary.id, [secondExternal.id]],
        [otherLibrary.id, []],
        [null, [upload.id]],
      ] as const) {
        const options = { libraryId, userIds: [user.id], embedding };
        const pagination = { page: 1, size: 100 };
        const result =
          type === 'metadata'
            ? await repository.searchMetadata(pagination, options)
            : await repository.searchSmart(pagination, options);

        expect(result.items.map(({ id }) => id).sort()).toEqual([...expected].sort());
      }
    });
  });

  it('should work', () => {
    const { sut } = setup();
    expect(sut).toBeDefined();
  });

  it('should return assets', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    const assets = [];
    const sizes = [12_334, 599, 123_456];

    for (let i = 0; i < sizes.length; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: sizes[i] });
      assets.push(asset);
    }

    const auth = factory.auth({ user: { id: user.id } });

    await expect(sut.searchLargeAssets(auth, {})).resolves.toEqual([
      expect.objectContaining({ id: assets[2].id }),
      expect.objectContaining({ id: assets[0].id }),
      expect.objectContaining({ id: assets[1].id }),
    ]);
  });

  describe('searchStatistics', () => {
    it('should return statistics when filtering by personIds', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });
      await ctx.newAssetFace({ assetId: asset.id, personId: person.id });

      const auth = factory.auth({ user: { id: user.id } });

      const result = await sut.searchStatistics(auth, { personIds: [person.id] });

      expect(result).toEqual({ total: 1 });
    });

    it('should return zero when no assets match the personIds filter', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });

      const auth = factory.auth({ user: { id: user.id } });

      const result = await sut.searchStatistics(auth, { personIds: [person.id] });

      expect(result).toEqual({ total: 0 });
    });
  });

  describe('withStacked option', () => {
    it('should exclude stacked assets when withStacked is false', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset: primaryAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: stackedAsset } = await ctx.newAsset({ ownerId: user.id });
      const { asset: unstackedAsset } = await ctx.newAsset({ ownerId: user.id });

      await ctx.newStack({ ownerId: user.id }, [primaryAsset.id, stackedAsset.id]);

      const auth = factory.auth({ user: { id: user.id } });

      const response = await sut.searchMetadata(auth, { withStacked: false });

      expect(response.assets.items.length).toBe(1);
      expect(response.assets.items[0].id).toBe(unstackedAsset.id);
    });
  });

  describe('getSearchSuggestions', () => {
    it('should filter out empty search suggestions', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, make: 'Canon' });

      const { asset: assetWithEmptyMake } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: assetWithEmptyMake.id, make: '' });

      const auth = factory.auth({ user: { id: user.id } });
      const suggestions = await sut.getSearchSuggestions(auth, {
        type: SearchSuggestionType.CAMERA_MAKE,
        includeNull: true,
      });

      expect(suggestions).toEqual(['Canon', null]);
    });
  });
});
