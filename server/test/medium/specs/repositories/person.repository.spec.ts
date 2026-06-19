import { Kysely } from 'kysely';
import { AssetFileType } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(PersonRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(PersonRepository.name, () => {
  describe('getAllForUser', () => {
    it('should only return people seen on the minimum number of distinct days', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();
      const { person: oneDayPerson } = await ctx.newPerson({ ownerId: user.id });
      const { person: twoDayPerson } = await ctx.newPerson({ ownerId: user.id });
      const oneDayDates = Array.from({ length: 20 }, (_, minute) => new Date(Date.UTC(2026, 0, 1, 9, minute)));
      const twoDayDates = [new Date('2026-01-01T09:00:00Z'), new Date('2026-01-02T09:00:00Z')];

      for (const [personId, dates] of [
        [oneDayPerson.id, oneDayDates],
        [twoDayPerson.id, twoDayDates],
      ] as const) {
        for (const localDateTime of dates) {
          const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime });
          await ctx.newAssetFace({ assetId: asset.id, personId });
        }
      }

      const result = await sut.getAllForUser({ take: 10, skip: 0 }, user.id, {
        withHidden: false,
        minimumDays: 2,
      });
      const count = await sut.getNumberOfPeople(user.id, { minimumDays: 2 });

      expect(result).toEqual({
        hasNextPage: false,
        items: [expect.objectContaining({ id: twoDayPerson.id })],
      });
      expect(count).toEqual({ total: 1, hidden: 0 });
    });
  });

  describe('getDataForThumbnailGenerationJob', () => {
    it('should not return the edited preview path', async () => {
      const { ctx, sut } = setup();
      const { user } = await ctx.newUser();

      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { person } = await ctx.newPerson({ ownerId: user.id });

      const { assetFace } = await ctx.newAssetFace({
        assetId: asset.id,
        personId: person.id,
        boundingBoxX1: 10,
        boundingBoxY1: 10,
        boundingBoxX2: 90,
        boundingBoxY2: 90,
      });

      // theres a circular dependency between assetFace and person, so we need to update the person after creating the assetFace
      await ctx.database.updateTable('person').set({ faceAssetId: assetFace.id }).where('id', '=', person.id).execute();

      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: 'preview_edited.jpg',
        isEdited: true,
      });
      await ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Preview,
        path: 'preview_unedited.jpg',
        isEdited: false,
      });

      const result = await sut.getDataForThumbnailGenerationJob(person.id);

      expect(result).toEqual(
        expect.objectContaining({
          previewPath: 'preview_unedited.jpg',
        }),
      );
    });
  });
});
