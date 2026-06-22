import { BadRequestException } from '@nestjs/common';
import { defaults } from 'src/config';
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto';
import { MapAsset } from 'src/dtos/asset-response.dto';
import { AssetType, AssetVisibility, JobName, JobStatus } from 'src/enum';
import { DuplicateService } from 'src/services/duplicate.service';
import { AssetFactory } from 'test/factories/asset.factory';
import { authStub } from 'test/fixtures/auth.stub';
import { getForDuplicate } from 'test/mappers';
import { newUuid } from 'test/small.factory';
import { makeStream, newTestService, ServiceMocks } from 'test/utils';
import { beforeEach, describe, expect, it, vitest } from 'vitest';

vitest.useFakeTimers();

const hasEmbedding = {
  id: 'asset-1',
  ownerId: 'user-id',
  stackId: null,
  type: AssetType.Image,
  duplicateId: null,
  embedding: '[1, 2, 3, 4]',
  visibility: AssetVisibility.Timeline,
};

const hasDupe = {
  ...hasEmbedding,
  id: 'asset-2',
  duplicateId: 'duplicate-id',
};

const autoStackAsset = (
  id: string,
  originalFileName: string,
  options: {
    dateTimeOriginal?: Date | null;
    duplicateId?: string | null;
    fileSizeInByte?: number;
    lensModel?: string | null;
    localDateTime?: Date;
    make?: string | null;
    model?: string | null;
    ownerId?: string;
    previewPath?: string | null;
    stackId?: string | null;
  } = {},
) => ({
  id,
  ownerId: options.ownerId ?? 'user-id',
  originalFileName,
  type: AssetType.Image,
  visibility: AssetVisibility.Timeline,
  stackId: options.stackId ?? null,
  duplicateId: options.duplicateId === undefined ? 'duplicate-id' : options.duplicateId,
  localDateTime: options.localDateTime ?? new Date('2025-01-01T00:00:00Z'),
  fileSizeInByte: options.fileSizeInByte ?? 1000,
  dateTimeOriginal:
    options.dateTimeOriginal === undefined ? new Date('2025-01-01T00:00:00Z') : options.dateTimeOriginal,
  make: options.make ?? null,
  model: options.model ?? null,
  lensModel: options.lensModel ?? null,
  previewPath: options.previewPath === undefined ? `/preview/${id}.jpeg` : options.previewPath,
});

const autoStackConfig = () => {
  const config = structuredClone(defaults);
  config.machineLearning.duplicateDetection.autoStack = true;
  return config;
};

const mockAutoStackAssets = (mocks: ServiceMocks, assets: ReturnType<typeof autoStackAsset>[]) => {
  mocks.duplicateRepository.getAutoStackSeed.mockImplementation((id) =>
    Promise.resolve(assets.find((asset) => asset.id === id) ?? assets[0]),
  );
  mocks.duplicateRepository.getAutoStackCandidates.mockResolvedValue(assets.slice(1));
};

describe(DuplicateService.name, () => {
  let sut: DuplicateService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(DuplicateService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getDuplicates', () => {
    it('should get duplicates', async () => {
      const asset = AssetFactory.from().exif().build();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['duplicate-id']));
      mocks.duplicateRepository.cleanupSingletonGroups.mockResolvedValue();
      mocks.duplicateRepository.getAll.mockResolvedValue([
        {
          duplicateId: 'duplicate-id',
          assets: [getForDuplicate(asset), getForDuplicate(asset)],
        },
      ]);
      await expect(sut.getDuplicates(authStub.admin)).resolves.toEqual([
        {
          duplicateId: 'duplicate-id',
          assets: [expect.objectContaining({ id: asset.id }), expect.objectContaining({ id: asset.id })],
          suggestedKeepAssetIds: [asset.id],
        },
      ]);
    });

    it('should return suggestedKeepAssetIds based on file size', async () => {
      const smallAsset = AssetFactory.from().exif({ fileSizeInByte: 1000 }).build();
      const largeAsset = AssetFactory.from().exif({ fileSizeInByte: 5000 }).build();
      mocks.duplicateRepository.cleanupSingletonGroups.mockResolvedValue();
      mocks.duplicateRepository.getAll.mockResolvedValue([
        {
          duplicateId: 'duplicate-id',
          assets: [getForDuplicate(smallAsset), getForDuplicate(largeAsset)],
        },
      ]);
      const result = await sut.getDuplicates(authStub.admin);
      expect(result[0].suggestedKeepAssetIds).toEqual([largeAsset.id]);
    });
  });

  describe('handleQueueSearchDuplicates', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
    });

    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: false,
          duplicateDetection: {
            enabled: true,
          },
        },
      });

      await expect(sut.handleQueueSearchDuplicates({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
    });

    it('should skip if duplicate detection is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: false,
          },
        },
      });

      await expect(sut.handleQueueSearchDuplicates({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queue).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
      expect(mocks.systemMetadata.get).toHaveBeenCalled();
    });

    it('should queue missing assets', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForSearchDuplicates.mockReturnValue(makeStream([asset]));

      await sut.handleQueueSearchDuplicates({});

      expect(mocks.assetJob.streamForSearchDuplicates).toHaveBeenCalledWith(undefined);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.AssetDetectDuplicates,
          data: { id: asset.id },
        },
      ]);
    });

    it('should queue all assets', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForSearchDuplicates.mockReturnValue(makeStream([asset]));

      await sut.handleQueueSearchDuplicates({ force: true });

      expect(mocks.assetJob.streamForSearchDuplicates).toHaveBeenCalledWith(true);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        {
          name: JobName.AssetDetectDuplicates,
          data: { id: asset.id },
        },
      ]);
    });
  });

  describe('delete', () => {
    it('should throw for an unknown or unauthorized group id', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set());
      await expect(sut.delete(authStub.admin, 'group-1')).rejects.toThrow(BadRequestException);
      expect(mocks.duplicateRepository.delete).not.toHaveBeenCalled();
    });

    it('should dismiss the duplicate group', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.delete.mockResolvedValue();
      await expect(sut.delete(authStub.admin, 'group-1')).resolves.toBeUndefined();
      expect(mocks.duplicateRepository.delete).toHaveBeenCalledWith(authStub.admin.user.id, 'group-1');
    });
  });

  describe('deleteAll', () => {
    it('should throw if any group id is unknown or unauthorized', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      await expect(sut.deleteAll(authStub.admin, { ids: ['group-1', 'group-2'] })).rejects.toThrow(BadRequestException);
      expect(mocks.duplicateRepository.deleteAll).not.toHaveBeenCalled();
    });

    it('should dismiss all duplicate groups', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1', 'group-2']));
      mocks.duplicateRepository.deleteAll.mockResolvedValue();
      await expect(sut.deleteAll(authStub.admin, { ids: ['group-1', 'group-2'] })).resolves.toBeUndefined();
      expect(mocks.duplicateRepository.deleteAll).toHaveBeenCalledWith(authStub.admin.user.id, ['group-1', 'group-2']);
    });
  });

  describe('resolve', () => {
    it('should handle mixed success and failure', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1', 'group-2']));
      mocks.duplicateRepository.get.mockResolvedValueOnce(void 0);
      mocks.duplicateRepository.get.mockResolvedValueOnce({
        duplicateId: 'group-2',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [
            { duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [] },
            { duplicateId: 'group-2', keepAssetIds: [asset.id], trashAssetIds: [] },
          ],
        }),
      ).resolves.toEqual([
        { id: 'group-1', success: false, error: BulkIdErrorReason.NOT_FOUND },
        { id: 'group-2', success: true },
      ]);
    });

    it('should catch and report errors', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockRejectedValue(new Error('Database error'));

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: false, error: BulkIdErrorReason.UNKNOWN }]);
    });
  });

  describe('resolveGroup (via resolve)', () => {
    it('should fail if duplicate group not found', async () => {
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['missing-id']));
      mocks.duplicateRepository.get.mockResolvedValue(void 0);

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'missing-id', keepAssetIds: [], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([
        {
          id: 'missing-id',
          success: false,
          error: BulkIdErrorReason.NOT_FOUND,
        },
      ]);
    });

    it('should skip when keepAssetIds contains non-member', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: ['asset-999', asset.id], trashAssetIds: [] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: true }]);
    });

    it('should skip when trashAssetIds contains non-member', async () => {
      const asset = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset as unknown as MapAsset],
      });

      await expect(
        sut.resolve(authStub.admin, {
          groups: [{ duplicateId: 'group-1', keepAssetIds: [asset.id], trashAssetIds: ['asset-999'] }],
        }),
      ).resolves.toEqual([{ id: 'group-1', success: true }]);
    });

    it('should fail if keepAssetIds and trashAssetIds overlap', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset1.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('An asset cannot be in both keepAssetIds and trashAssetIds');
    });

    it('should fail if keepAssetIds and trashAssetIds do not cover all assets', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const asset3 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset, asset3 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('Every asset must be in either keepAssetIds or trashAssetIds');
    });

    it('should fail if partial trash without keepers', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [], trashAssetIds: [asset1.id] }],
      });

      expect(result[0].success).toBe(false);
      expect(result[0].errorMessage).toContain('Every asset must be in either keepAssetIds or trashAssetIds');
    });

    it('should sync merged tags to asset_exif.tags', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-2']));
      mocks.access.tag.checkOwnerAccess.mockResolvedValue(new Set(['tag-1', 'tag-2']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [
          {
            ...asset1,
            tags: [
              {
                id: 'tag-1',
                value: 'Work',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                parentId: null,
                color: null,
              },
            ],
          },
          {
            ...asset2,
            tags: [
              {
                id: 'tag-2',
                value: 'Travel',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                parentId: null,
                color: null,
              },
            ],
          },
        ] as any,
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id], trashAssetIds: [asset2.id] }],
      });

      expect(result[0].success).toBe(true);

      // Verify tags were applied to tag_asset table
      expect(mocks.tag.replaceAssetTags).toHaveBeenCalledWith(asset1.id, ['tag-1', 'tag-2']);

      // Verify merged tag values were written to asset_exif.tags so SidecarWrite preserves them
      expect(mocks.asset.updateAllExif).toHaveBeenCalledWith([asset1.id], { tags: ['Work', 'Travel'] });

      // Verify SidecarWrite was queued (to write tags to sidecar)
      expect(mocks.job.queueAll).toHaveBeenCalledWith([{ name: JobName.SidecarWrite, data: { id: asset1.id } }]);
    });

    it('should not merge metadata when multiple assets are kept', async () => {
      const asset1 = AssetFactory.create({ isFavorite: true });
      const asset2 = AssetFactory.create();
      mocks.access.duplicate.checkOwnerAccess.mockResolvedValue(new Set(['group-1']));
      mocks.duplicateRepository.get.mockResolvedValue({
        duplicateId: 'group-1',
        assets: [asset1 as unknown as MapAsset, asset2 as unknown as MapAsset],
      });

      const result = await sut.resolve(authStub.admin, {
        groups: [{ duplicateId: 'group-1', keepAssetIds: [asset1.id, asset2.id], trashAssetIds: [] }],
      });

      expect(result[0].success).toBe(true);
      expect(mocks.album.addAssetIdsToAlbums).not.toHaveBeenCalled();
      expect(mocks.tag.replaceAssetTags).not.toHaveBeenCalled();
      expect(mocks.asset.updateAllExif).not.toHaveBeenCalled();
      expect(mocks.asset.updateAll).toHaveBeenCalledWith([asset1.id, asset2.id], { duplicateId: null });
    });

    // NOTE: The following integration-style tests are covered by E2E tests instead
    // to avoid complex mock setup. The validation and error-handling logic above
    // is thoroughly unit tested.
  });

  describe('handleSearchDuplicates', () => {
    beforeEach(() => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
    });

    it('should skip if machine learning is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: false,
          duplicateDetection: {
            enabled: true,
          },
        },
      });
      const result = await sut.handleSearchDuplicates({ id: newUuid() });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.assetJob.getForSearchDuplicatesJob).not.toHaveBeenCalled();
    });

    it('should skip if duplicate detection is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: {
          enabled: true,
          duplicateDetection: {
            enabled: false,
          },
        },
      });
      const result = await sut.handleSearchDuplicates({ id: newUuid() });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.assetJob.getForSearchDuplicatesJob).not.toHaveBeenCalled();
    });

    it('should fail if asset is not found', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(void 0);

      const asset = AssetFactory.create();
      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Failed);
      expect(mocks.logger.error).toHaveBeenCalledWith(`Asset ${asset.id} not found`);
    });

    it('should skip if asset is part of stack', async () => {
      const asset = AssetFactory.from().stack().build();
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, stackId: asset.stackId });

      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is part of a stack, skipping`);
    });

    it('should skip if asset is not visible', async () => {
      const asset = AssetFactory.create({ visibility: AssetVisibility.Hidden });
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, ...asset });

      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Skipped);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is not visible, skipping`);
    });

    it('should fail if asset is missing embedding', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...hasEmbedding, embedding: null });

      const asset = AssetFactory.create();
      const result = await sut.handleSearchDuplicates({ id: asset.id });

      expect(result).toBe(JobStatus.Failed);
      expect(mocks.logger.debug).toHaveBeenCalledWith(`Asset ${asset.id} is missing embedding`);
    });

    it('should search for duplicates and update asset with duplicateId', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      const asset = AssetFactory.create();
      mocks.duplicateRepository.search.mockResolvedValue([{ assetId: asset.id, distance: 0.01, duplicateId: null }]);
      mocks.duplicateRepository.merge.mockResolvedValue();
      const expectedAssetIds = [asset.id, hasEmbedding.id];

      const result = await sut.handleSearchDuplicates({ id: hasEmbedding.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.search).toHaveBeenCalledWith({
        assetId: hasEmbedding.id,
        embedding: hasEmbedding.embedding,
        maxDistance: 0.01,
        type: hasEmbedding.type,
        userIds: [hasEmbedding.ownerId],
      });
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: expectedAssetIds,
        targetId: expect.any(String),
        sourceIds: [],
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        ...expectedAssetIds.map((assetId) => ({ assetId, duplicatesDetectedAt: expect.any(Date) })),
      );
    });

    it('should enqueue auto-stacking for the seed asset when enabled', async () => {
      const config = structuredClone(defaults);
      config.machineLearning.duplicateDetection.autoStack = true;
      mocks.systemMetadata.get.mockResolvedValue(config);
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      mocks.duplicateRepository.search.mockResolvedValue([{ assetId: hasDupe.id, distance: 0.01, duplicateId: null }]);
      mocks.duplicateRepository.merge.mockResolvedValue();
      mocks.crypto.randomUUID.mockReturnValue('duplicate-id');

      await expect(sut.handleSearchDuplicates({ id: hasEmbedding.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetAutoStackDuplicates,
        data: { id: hasEmbedding.id },
      });
    });

    it('should enqueue auto-stacking when CLIP finds no duplicates', async () => {
      const config = autoStackConfig();
      mocks.systemMetadata.get.mockResolvedValue(config);
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      mocks.duplicateRepository.search.mockResolvedValue([]);

      await expect(sut.handleSearchDuplicates({ id: hasEmbedding.id })).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetAutoStackDuplicates,
        data: { id: hasEmbedding.id },
      });
    });

    it('should use existing duplicate ID among matched duplicates', async () => {
      const duplicateId = hasDupe.duplicateId;
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasEmbedding);
      mocks.duplicateRepository.search.mockResolvedValue([{ assetId: hasDupe.id, distance: 0.01, duplicateId }]);
      mocks.duplicateRepository.merge.mockResolvedValue();
      const expectedAssetIds = [hasEmbedding.id];

      const result = await sut.handleSearchDuplicates({ id: hasEmbedding.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.duplicateRepository.search).toHaveBeenCalledWith({
        assetId: hasEmbedding.id,
        embedding: hasEmbedding.embedding,
        maxDistance: 0.01,
        type: hasEmbedding.type,
        userIds: [hasEmbedding.ownerId],
      });
      expect(mocks.duplicateRepository.merge).toHaveBeenCalledWith({
        assetIds: expectedAssetIds,
        targetId: duplicateId,
        sourceIds: [],
      });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith(
        ...expectedAssetIds.map((assetId) => ({ assetId, duplicatesDetectedAt: expect.any(Date) })),
      );
    });

    it('should remove duplicateId if no duplicates found and asset has duplicateId', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(hasDupe);
      mocks.duplicateRepository.search.mockResolvedValue([]);

      const result = await sut.handleSearchDuplicates({ id: hasDupe.id });

      expect(result).toBe(JobStatus.Success);
      expect(mocks.asset.update).toHaveBeenCalledWith({ id: hasDupe.id, duplicateId: null });
      expect(mocks.asset.upsertJobStatus).toHaveBeenCalledWith({
        assetId: hasDupe.id,
        duplicatesDetectedAt: expect.any(Date),
      });
    });
  });

  describe('automatic duplicate stacking', () => {
    it('should enqueue a backfill on startup and when enabled', async () => {
      const enabled = autoStackConfig();
      const disabled = structuredClone(enabled);
      disabled.machineLearning.duplicateDetection.autoStack = false;

      await sut.onConfigInit({ newConfig: enabled });
      await sut.onConfigUpdate({ oldConfig: disabled, newConfig: enabled });

      expect(mocks.job.queue).toHaveBeenCalledTimes(2);
      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetAutoStackDuplicatesQueueAll,
        data: {},
      });
    });

    it('should not enqueue a backfill while disabled', async () => {
      const disabled = structuredClone(defaults);

      await sut.onConfigInit({ newConfig: disabled });
      await sut.onConfigUpdate({ oldConfig: disabled, newConfig: disabled });

      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it.each([
      ['machine learning', (config: typeof defaults) => (config.machineLearning.enabled = false)],
      ['CLIP', (config: typeof defaults) => (config.machineLearning.clip.enabled = false)],
      ['duplicate detection', (config: typeof defaults) => (config.machineLearning.duplicateDetection.enabled = false)],
    ])('should enqueue a backfill when re-enabling %s', async (_, disable) => {
      const enabled = autoStackConfig();
      const disabled = structuredClone(enabled);
      disable(disabled);

      await sut.onConfigUpdate({ oldConfig: disabled, newConfig: enabled });

      expect(mocks.job.queue).toHaveBeenCalledWith({
        name: JobName.AssetAutoStackDuplicatesQueueAll,
        data: {},
      });
    });

    it('should fan out all eligible assets including assets without a duplicate ID', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mocks.duplicateRepository.streamForAutoStack.mockReturnValue(
        makeStream([{ id: 'asset-without-duplicate-id' }, { id: 'asset-with-duplicate-id' }]),
      );

      await expect(sut.handleQueueAutoStackDuplicates()).resolves.toBe(JobStatus.Success);

      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetAutoStackDuplicates, data: { id: 'asset-without-duplicate-id' } },
        { name: JobName.AssetAutoStackDuplicates, data: { id: 'asset-with-duplicate-id' } },
      ]);
    });

    it('should skip queue-all and per-group jobs while disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue(defaults);

      await expect(sut.handleQueueAutoStackDuplicates()).resolves.toBe(JobStatus.Skipped);
      await expect(sut.handleAutoStackDuplicates({ id: 'group-1' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.duplicateRepository.streamForAutoStack).not.toHaveBeenCalled();
      expect(mocks.duplicateRepository.getAutoStackSeed).not.toHaveBeenCalled();
    });

    it('should choose JPEG, larger file, and ID order as the primary and emit StackCreate', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('raw', 'photo.nef', { fileSizeInByte: 9000 }),
        autoStackAsset('png', 'photo.png', { fileSizeInByte: 8000 }),
        autoStackAsset('jpeg-b', 'photo.jpeg', { fileSizeInByte: 3000 }),
        autoStackAsset('jpeg-a', 'photo.jpg', { fileSizeInByte: 3000 }),
      ]);
      mocks.media.getPerceptualHash.mockResolvedValue(1n);
      mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);

      await expect(sut.handleAutoStackDuplicates({ id: 'group-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: 'user-id' }, ['jpeg-a', 'png', 'raw'], {
        clearDuplicateId: true,
      });
      expect(mocks.event.emit).toHaveBeenCalledWith('StackCreate', {
        stackId: 'stack-id',
        userId: 'user-id',
      });
      expect(mocks.media.getPerceptualHash.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mocks.database.withLock.mock.invocationCallOrder[0],
      );
    });

    it('should skip same-format copies', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [autoStackAsset('jpeg-1', 'one.jpg'), autoStackAsset('jpeg-2', 'two.jpeg')]);
      mocks.media.getPerceptualHash.mockResolvedValue(1n);

      await expect(sut.handleAutoStackDuplicates({ id: 'group-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.stack.create).not.toHaveBeenCalled();
    });

    it('should omit lower-priority copies of a selected format', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('jpeg-small', 'small.jpg', { fileSizeInByte: 1000 }),
        autoStackAsset('png', 'photo.png', { fileSizeInByte: 2000 }),
        autoStackAsset('jpeg-large', 'large.jpeg', { fileSizeInByte: 3000 }),
      ]);
      mocks.media.getPerceptualHash.mockResolvedValue(1n);
      mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);

      await expect(sut.handleAutoStackDuplicates({ id: 'group-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: 'user-id' }, ['jpeg-large', 'png'], {
        clearDuplicateId: true,
      });
      expect(mocks.stack.create).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(['jpeg-small']),
        expect.anything(),
      );
    });

    it('should skip perceptually different mixed formats', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [autoStackAsset('jpeg', 'one.jpg'), autoStackAsset('png', 'two.png')]);
      mocks.media.getPerceptualHash.mockResolvedValueOnce(0n).mockResolvedValueOnce((1n << 64n) - 1n);

      await expect(sut.handleAutoStackDuplicates({ id: 'group-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.stack.create).not.toHaveBeenCalled();
      expect(mocks.logger.debug).toHaveBeenCalledWith(
        'Auto-stack asset png rejected from cluster [jpeg]: jpeg=64 (threshold=6)',
      );
    });

    it('should stack metadata-matched camera variants without a duplicate ID', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('jpeg', 'edited-name.jpg', {
          duplicateId: null,
          make: 'Canon',
          model: 'EOS R5',
          lensModel: 'RF24-70mm F2.8',
        }),
        autoStackAsset('raw', 'original-name.cr3', {
          duplicateId: null,
          make: 'canon',
          model: 'eos r5',
          lensModel: 'rf24-70mm f2.8',
        }),
      ]);
      mocks.media.getPerceptualHash.mockResolvedValue(1n);
      mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);

      await expect(sut.handleAutoStackDuplicates({ id: 'jpeg' })).resolves.toBe(JobStatus.Success);

      expect(mocks.duplicateRepository.getAutoStackCandidates).toHaveBeenCalledWith({
        assetId: 'jpeg',
        ownerId: 'user-id',
        duplicateId: null,
        localDateTime: new Date('2025-01-01T00:00:00Z'),
        dateTimeOriginal: new Date('2025-01-01T00:00:00Z'),
      });
      expect(mocks.media.getPerceptualHash).toHaveBeenCalledTimes(2);
      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: 'user-id' }, ['jpeg', 'raw'], {
        clearDuplicateId: true,
      });
    });

    it('should stack Pixel RAW and JPEG variants by normalized capture basename', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('jpeg', 'PXL_20250101_120000.RAW-01.COVER.jpg', { duplicateId: null }),
        autoStackAsset('raw', 'PXL_20250101_120000.RAW-02.ORIGINAL.dng', { duplicateId: null }),
      ]);
      mocks.media.getPerceptualHash.mockResolvedValue(1n);
      mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);

      await expect(sut.handleAutoStackDuplicates({ id: 'jpeg' })).resolves.toBe(JobStatus.Success);

      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: 'user-id' }, ['jpeg', 'raw'], {
        clearDuplicateId: true,
      });
    });

    it('should reject timestamp-adjacent assets with unrelated basename and camera', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('jpeg', 'first.jpg', {
          duplicateId: null,
          make: 'Canon',
          model: 'EOS R5',
          lensModel: 'RF24-70mm',
        }),
        autoStackAsset('raw', 'second.nef', {
          duplicateId: null,
          make: 'Nikon',
          model: 'Z8',
          lensModel: 'Nikkor 24-70mm',
        }),
      ]);

      await expect(sut.handleAutoStackDuplicates({ id: 'jpeg' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.media.getPerceptualHash).not.toHaveBeenCalled();
      expect(mocks.stack.create).not.toHaveBeenCalled();
    });

    it('should not broadly match timestamp-adjacent assets with missing capture metadata', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('jpeg', 'first.jpg', { duplicateId: null }),
        autoStackAsset('raw', 'second.dng', { duplicateId: null }),
      ]);

      await expect(sut.handleAutoStackDuplicates({ id: 'jpeg' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.media.getPerceptualHash).not.toHaveBeenCalled();
      expect(mocks.stack.create).not.toHaveBeenCalled();
    });

    it('should not match same camera and timestamp when lens metadata is missing', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('jpeg', 'first.jpg', {
          duplicateId: null,
          make: 'Canon',
          model: 'EOS R5',
          lensModel: null,
        }),
        autoStackAsset('raw', 'second.cr3', {
          duplicateId: null,
          make: 'Canon',
          model: 'EOS R5',
          lensModel: null,
        }),
      ]);

      await expect(sut.handleAutoStackDuplicates({ id: 'jpeg' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.media.getPerceptualHash).not.toHaveBeenCalled();
      expect(mocks.stack.create).not.toHaveBeenCalled();
    });

    it('should not join dissimilar endpoints through a transitive perceptual match', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('raw-c', 'three.nef'),
        autoStackAsset('png-b', 'two.png'),
        autoStackAsset('jpeg-a', 'one.jpg'),
      ]);
      mocks.media.getPerceptualHash.mockImplementation((path) => {
        if (path === '/preview/jpeg-a.jpeg') {
          return Promise.resolve(0n);
        }
        if (path === '/preview/png-b.jpeg') {
          return Promise.resolve(0b11_1111n);
        }
        return Promise.resolve(0b1111_1111_1111n);
      });
      mocks.stack.create.mockResolvedValue({ id: 'stack-id' } as any);

      await expect(sut.handleAutoStackDuplicates({ id: 'group-1' })).resolves.toBe(JobStatus.Success);

      expect(mocks.stack.create).toHaveBeenCalledOnce();
      expect(mocks.stack.create).toHaveBeenCalledWith({ ownerId: 'user-id' }, ['jpeg-a', 'png-b'], {
        clearDuplicateId: true,
      });
      expect(mocks.stack.create).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(['jpeg-a', 'raw-c']),
        expect.anything(),
      );
    });

    it('should refuse to stack a component containing multiple owners', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('jpeg', 'one.jpg'),
        autoStackAsset('png', 'two.png', { ownerId: 'other-user-id' }),
      ]);
      mocks.media.getPerceptualHash.mockResolvedValue(1n);

      await expect(sut.handleAutoStackDuplicates({ id: 'group-1' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.stack.create).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Refusing to auto-stack duplicate group group-1 with assets from multiple owners',
      );
    });

    it('should skip assets that are already stacked or missing a preview', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      mockAutoStackAssets(mocks, [
        autoStackAsset('jpeg', 'one.jpg'),
        autoStackAsset('png-stacked', 'two.png', { stackId: 'stack-id' }),
        autoStackAsset('png-no-preview', 'three.png', { previewPath: null }),
      ]);

      await expect(sut.handleAutoStackDuplicates({ id: 'group-1' })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.media.getPerceptualHash).not.toHaveBeenCalled();
      expect(mocks.stack.create).not.toHaveBeenCalled();
    });

    it('should skip when an asset becomes stacked before final creation', async () => {
      mocks.systemMetadata.get.mockResolvedValue(autoStackConfig());
      const seed = autoStackAsset('jpeg', 'one.jpg');
      const candidate = autoStackAsset('png', 'two.png');
      mocks.duplicateRepository.getAutoStackSeed
        .mockResolvedValueOnce(seed)
        .mockResolvedValueOnce({ ...seed, stackId: 'existing-stack' })
        .mockResolvedValueOnce(candidate);
      mocks.duplicateRepository.getAutoStackCandidates.mockResolvedValue([candidate]);
      mocks.media.getPerceptualHash.mockResolvedValue(1n);

      await expect(sut.handleAutoStackDuplicates({ id: 'jpeg' })).resolves.toBe(JobStatus.Skipped);

      expect(mocks.media.getPerceptualHash).toHaveBeenCalledTimes(2);
      expect(mocks.database.withLock).toHaveBeenCalled();
      expect(mocks.stack.create).not.toHaveBeenCalled();
    });
  });
});
