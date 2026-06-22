import { Injectable } from '@nestjs/common';
import { extname } from 'node:path';
import { JOBS_ASSET_PAGINATION_SIZE } from 'src/constants';
import { OnEvent, OnJob } from 'src/decorators';
import { BulkIdErrorReason, BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { MapAsset, mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { DuplicateResolveDto, DuplicateResolveGroupDto, DuplicateResponseDto } from 'src/dtos/duplicate.dto';
import {
  AssetStatus,
  AssetType,
  AssetVisibility,
  DatabaseLock,
  JobName,
  JobStatus,
  Permission,
  QueueName,
} from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { AssetDuplicateResult } from 'src/repositories/search.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { suggestDuplicateKeepAssetIds } from 'src/utils/duplicate';
import { mimeTypes } from 'src/utils/mime-types';
import { isDuplicateDetectionEnabled } from 'src/utils/misc';
import { getHammingDistance } from 'src/utils/perceptual-hash';

enum AutoStackFormat {
  Jpeg,
  Png,
  Raw,
}

type AutoStackSeed = NonNullable<Awaited<ReturnType<DuplicateService['duplicateRepository']['getAutoStackSeed']>>>;

type AutoStackAsset = AutoStackSeed & {
  format: AutoStackFormat;
  hash: bigint;
};

const compareAutoStackAssets = (
  first: Pick<AutoStackAsset, 'fileSizeInByte' | 'format' | 'id'>,
  second: Pick<AutoStackAsset, 'fileSizeInByte' | 'format' | 'id'>,
) => {
  if (first.format !== second.format) {
    return first.format - second.format;
  }
  const firstSize = first.fileSizeInByte ?? 0;
  const secondSize = second.fileSizeInByte ?? 0;
  if (firstSize !== secondSize) {
    return firstSize > secondSize ? -1 : 1;
  }
  return first.id.localeCompare(second.id);
};

const getAutoStackFormat = (fileName: string): AutoStackFormat | undefined => {
  const extension = extname(fileName).toLowerCase();
  if (['.jpg', '.jpeg', '.jpe'].includes(extension)) {
    return AutoStackFormat.Jpeg;
  }
  if (extension === '.png') {
    return AutoStackFormat.Png;
  }
  if (mimeTypes.isRaw(fileName)) {
    return AutoStackFormat.Raw;
  }
};

const normalizeCaptureBasename = (fileName: string) => {
  const lower = fileName.toLowerCase();
  const rawMarker = lower.indexOf('.raw-');
  return (rawMarker === -1 ? fileName.slice(0, -extname(fileName).length) : fileName.slice(0, rawMarker))
    .trim()
    .toLowerCase();
};

const normalizeCaptureMetadata = (value: string | null) => value?.trim().toLowerCase() || null;

const hasMatchingCaptureIdentity = (seed: AutoStackSeed, candidate: AutoStackSeed) => {
  const seedBasename = normalizeCaptureBasename(seed.originalFileName);
  const candidateBasename = normalizeCaptureBasename(candidate.originalFileName);
  if (seedBasename && seedBasename === candidateBasename) {
    return true;
  }

  const seedMake = normalizeCaptureMetadata(seed.make);
  const seedModel = normalizeCaptureMetadata(seed.model);
  const candidateMake = normalizeCaptureMetadata(candidate.make);
  const candidateModel = normalizeCaptureMetadata(candidate.model);
  if (!seedMake || !seedModel || seedMake !== candidateMake || seedModel !== candidateModel) {
    return false;
  }

  const seedLens = normalizeCaptureMetadata(seed.lensModel);
  const candidateLens = normalizeCaptureMetadata(candidate.lensModel);
  return !!seedLens && seedLens === candidateLens;
};

const isWithinCaptureWindow = (seed: AutoStackSeed, candidate: AutoStackSeed) =>
  Math.abs(seed.localDateTime.getTime() - candidate.localDateTime.getTime()) <= 1000 ||
  (!!seed.dateTimeOriginal &&
    !!candidate.dateTimeOriginal &&
    Math.abs(seed.dateTimeOriginal.getTime() - candidate.dateTimeOriginal.getTime()) <= 1000);

type ResolveRequest = {
  assetUpdate: {
    isFavorite?: boolean;
    visibility?: AssetVisibility;
  };

  exifUpdate: {
    rating?: number;
    latitude?: number;
    longitude?: number;
    description?: string;
  };

  mergedAlbumIds: string[];

  mergedTagIds: string[];

  mergedTagValues: string[];
};

const uniqueNonEmptyLines = (values: Array<string | null | undefined>): string[] => {
  const unique = new Set<string>();
  const lines: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const line of value.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || unique.has(trimmed)) {
        continue;
      }
      unique.add(trimmed);
      lines.push(trimmed);
    }
  }
  return lines;
};

const getUniqueCoordinate = (assets: MapAsset[], key: 'latitude' | 'longitude'): number | null => {
  const values = assets
    .map((asset) => asset.exifInfo?.[key])
    .filter((value): value is number => Number.isFinite(value));

  if (values.length === 0) {
    return null;
  }

  const unique = new Set(values);
  return unique.size === 1 ? [...unique][0] : null;
};

@Injectable()
export class DuplicateService extends BaseService {
  @OnEvent({ name: 'ConfigInit', server: true })
  async onConfigInit({ newConfig: { machineLearning } }: ArgOf<'ConfigInit'>) {
    if (isDuplicateDetectionEnabled(machineLearning) && machineLearning.duplicateDetection.autoStack) {
      await this.jobRepository.queue({ name: JobName.AssetAutoStackDuplicatesQueueAll, data: {} });
    }
  }

  @OnEvent({ name: 'ConfigUpdate', server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    const wasEnabled =
      isDuplicateDetectionEnabled(oldConfig.machineLearning) && oldConfig.machineLearning.duplicateDetection.autoStack;
    const isEnabled =
      isDuplicateDetectionEnabled(newConfig.machineLearning) && newConfig.machineLearning.duplicateDetection.autoStack;
    if (!wasEnabled && isEnabled) {
      await this.jobRepository.queue({ name: JobName.AssetAutoStackDuplicatesQueueAll, data: {} });
    }
  }

  async getDuplicates(auth: AuthDto): Promise<DuplicateResponseDto[]> {
    // Clean up singleton groups (assets that are the only member of their duplicate group)
    await this.duplicateRepository.cleanupSingletonGroups(auth.user.id);

    const duplicates = await this.duplicateRepository.getAll(auth.user.id);
    return duplicates.map(({ duplicateId, assets }) => {
      const mappedAssets = assets.map((asset) => mapAsset(asset, { auth }));
      return {
        duplicateId,
        assets: mappedAssets,
        suggestedKeepAssetIds: suggestDuplicateKeepAssetIds(mappedAssets),
      };
    });
  }

  async delete(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.DuplicateDelete, ids: [id] });
    await this.duplicateRepository.delete(auth.user.id, id);
  }

  async deleteAll(auth: AuthDto, dto: BulkIdsDto) {
    await this.requireAccess({ auth, permission: Permission.DuplicateDelete, ids: dto.ids });
    await this.duplicateRepository.deleteAll(auth.user.id, dto.ids);
  }

  async resolve(auth: AuthDto, dto: DuplicateResolveDto) {
    const duplicateIds = dto.groups.map(({ duplicateId }) => duplicateId);

    await this.requireAccess({ auth, permission: Permission.DuplicateDelete, ids: duplicateIds });

    const results: BulkIdResponseDto[] = [];

    for (const group of dto.groups) {
      try {
        results.push(await this.resolveGroup(auth, group));
      } catch (error: Error | any) {
        this.logger.error(`Error resolving duplicate group ${group.duplicateId}: ${error}`, error?.stack);
        results.push({ id: group.duplicateId, success: false, error: BulkIdErrorReason.UNKNOWN });
      }
    }

    return results;
  }

  private async resolveGroup(auth: AuthDto, group: DuplicateResolveGroupDto): Promise<BulkIdResponseDto> {
    const { duplicateId, keepAssetIds, trashAssetIds } = group;

    const duplicateGroup = await this.duplicateRepository.get(duplicateId);
    if (!duplicateGroup) {
      return { id: duplicateId, success: false, error: BulkIdErrorReason.NOT_FOUND };
    }

    const groupAssetIds = new Set(duplicateGroup.assets.map((a) => a.id));

    // ignore/skip asset IDs not in the group
    const idsToKeep = keepAssetIds.filter((id) => groupAssetIds.has(id));
    const idsToTrash = trashAssetIds.filter((id) => groupAssetIds.has(id));

    for (const assetId of groupAssetIds) {
      if (idsToKeep.includes(assetId) && idsToTrash.includes(assetId)) {
        return {
          id: duplicateId,
          success: false,
          error: BulkIdErrorReason.VALIDATION,
          errorMessage: 'An asset cannot be in both keepAssetIds and trashAssetIds',
        };
      }

      if (!idsToKeep.includes(assetId) && !idsToTrash.includes(assetId)) {
        return {
          id: duplicateId,
          success: false,
          error: BulkIdErrorReason.VALIDATION,
          errorMessage: 'Every asset must be in either keepAssetIds or trashAssetIds',
        };
      }
    }

    if (idsToTrash.length > 0) {
      const ids = await this.checkAccess({ auth, permission: Permission.AssetDelete, ids: idsToTrash });
      if (ids.size !== idsToTrash.length) {
        return {
          id: duplicateId,
          success: false,
          error: BulkIdErrorReason.NO_PERMISSION,
          errorMessage: 'No permission to delete assets',
        };
      }
    }

    // Only merge metadata into the keeper when exactly one asset can absorb trashed duplicates.
    if (idsToKeep.length === 1 && idsToTrash.length > 0) {
      const assetAlbumMap = await this.albumRepository.getByAssetIds(auth.user.id, [...groupAssetIds]);

      const { assetUpdate, exifUpdate, mergedAlbumIds, mergedTagIds, mergedTagValues } = this.getSyncMergeResult(
        duplicateGroup.assets,
        assetAlbumMap,
      );

      if (mergedAlbumIds.length > 0) {
        const allowedAlbumIds = await this.checkAccess({
          auth,
          permission: Permission.AlbumAssetCreate,
          ids: mergedAlbumIds,
        });

        const allowedShareIds = await this.checkAccess({
          auth,
          permission: Permission.AssetShare,
          ids: idsToKeep,
        });

        if (allowedAlbumIds.size > 0 && allowedShareIds.size > 0) {
          await this.albumRepository.addAssetIdsToAlbums(
            [...allowedAlbumIds].flatMap((albumId) => [...allowedShareIds].map((assetId) => ({ albumId, assetId }))),
          );
        }
      }

      if (mergedTagIds.length > 0) {
        const allowedTagIds = await this.checkAccess({
          auth,
          permission: Permission.TagAsset,
          ids: mergedTagIds,
        });

        if (allowedTagIds.size > 0) {
          await Promise.all(
            idsToKeep.map((assetId) => this.tagRepository.replaceAssetTags(assetId, [...allowedTagIds])),
          );

          await this.assetRepository.updateAllExif(idsToKeep, { tags: mergedTagValues });
        }
      }

      const hasExifUpdate = Object.keys(exifUpdate).length > 0;
      const hasTagUpdate = mergedTagIds.length > 0;

      if (hasExifUpdate) {
        await this.assetRepository.updateAllExif(idsToKeep, exifUpdate);
      }

      if (hasExifUpdate || hasTagUpdate) {
        await this.jobRepository.queueAll(idsToKeep.map((id) => ({ name: JobName.SidecarWrite, data: { id } })));
      }

      await this.assetRepository.updateAll(idsToKeep, { duplicateId: null, ...assetUpdate });
    } else if (idsToKeep.length > 0) {
      await this.assetRepository.updateAll(idsToKeep, { duplicateId: null });
    }

    if (idsToTrash.length > 0) {
      // TODO: this is duplicated with AssetService.deleteAssets
      const { trash } = await this.getConfig({ withCache: true });
      const force = !trash.enabled;

      await this.assetRepository.updateAll(idsToTrash, {
        deletedAt: new Date(),
        status: force ? AssetStatus.Deleted : AssetStatus.Trashed,
        duplicateId: null,
      });

      await this.eventRepository.emit(force ? 'AssetDeleteAll' : 'AssetTrashAll', {
        assetIds: idsToTrash,
        userId: auth.user.id,
      });
    }

    return { id: duplicateId, success: true };
  }

  private getSyncMergeResult(assets: MapAsset[], assetAlbumMap: Map<string, string[]> = new Map()): ResolveRequest {
    const response: ResolveRequest = {
      mergedAlbumIds: [],
      mergedTagIds: [],
      mergedTagValues: [],
      assetUpdate: {},
      exifUpdate: {},
    };

    response.assetUpdate.isFavorite = assets.some((asset) => asset.isFavorite);

    const visibilityOrder = [AssetVisibility.Locked, AssetVisibility.Archive, AssetVisibility.Timeline];
    let visibility = visibilityOrder.find((level) => assets.some((asset) => asset.visibility === level));
    if (!visibility && assets.some((asset) => asset.visibility === AssetVisibility.Hidden)) {
      visibility = AssetVisibility.Hidden;
    }
    if (visibility) {
      response.assetUpdate.visibility = visibility;
    }

    let rating = 0;
    for (const asset of assets) {
      const assetRating = asset.exifInfo?.rating ?? 0;
      if (assetRating > rating) {
        rating = assetRating;
      }
    }
    if (rating > 0) {
      response.exifUpdate.rating = rating;
    }

    const descriptionLines = uniqueNonEmptyLines(assets.map((asset) => asset.exifInfo?.description));
    const description = descriptionLines.length > 0 ? descriptionLines.join('\n') : null;
    if (description !== null) {
      response.exifUpdate.description = description;
    }

    const latitude = getUniqueCoordinate(assets, 'latitude');
    const longitude = getUniqueCoordinate(assets, 'longitude');
    if (latitude !== null && longitude !== null) {
      response.exifUpdate.latitude = latitude;
      response.exifUpdate.longitude = longitude;
    }

    const albumIdSet = new Set<string>();
    for (const [, albumIds] of assetAlbumMap) {
      for (const albumId of albumIds) {
        albumIdSet.add(albumId);
      }
    }
    response.mergedAlbumIds = [...albumIdSet];

    const allTags = assets.flatMap((asset) => asset.tags ?? []);
    const tagIds = [...new Set(allTags.map((tag) => tag.id).filter((id): id is string => !!id))];
    const tagValues = [...new Set(allTags.map((tag) => tag.value).filter((v): v is string => !!v))];
    if (tagIds.length > 0) {
      response.mergedTagIds = tagIds;
      response.mergedTagValues = tagValues;
    }

    return response;
  }

  @OnJob({ name: JobName.AssetDetectDuplicatesQueueAll, queue: QueueName.DuplicateDetection })
  async handleQueueSearchDuplicates({ force }: JobOf<JobName.AssetDetectDuplicatesQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isDuplicateDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const queueAll = async () => {
      await this.jobRepository.queueAll(jobs);
      jobs = [];
    };

    const assets = this.assetJobRepository.streamForSearchDuplicates(force);
    for await (const asset of assets) {
      jobs.push({ name: JobName.AssetDetectDuplicates, data: { id: asset.id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await queueAll();
      }
    }

    await queueAll();

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetDetectDuplicates, queue: QueueName.DuplicateDetection })
  async handleSearchDuplicates({ id }: JobOf<JobName.AssetDetectDuplicates>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isDuplicateDetectionEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForSearchDuplicatesJob(id);
    if (!asset) {
      this.logger.error(`Asset ${id} not found`);
      return JobStatus.Failed;
    }

    if (asset.stackId) {
      this.logger.debug(`Asset ${id} is part of a stack, skipping`);
      return JobStatus.Skipped;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      this.logger.debug(`Asset ${id} is not visible, skipping`);
      return JobStatus.Skipped;
    }

    if (asset.visibility === AssetVisibility.Locked) {
      this.logger.debug(`Asset ${id} is locked, skipping`);
      return JobStatus.Skipped;
    }

    if (!asset.embedding) {
      this.logger.debug(`Asset ${id} is missing embedding`);
      return JobStatus.Failed;
    }

    const duplicateAssets = await this.duplicateRepository.search({
      assetId: asset.id,
      embedding: asset.embedding,
      maxDistance: machineLearning.duplicateDetection.maxDistance,
      type: asset.type,
      userIds: [asset.ownerId],
    });

    let assetIds = [asset.id];
    if (duplicateAssets.length > 0) {
      this.logger.debug(
        `Found ${duplicateAssets.length} duplicate${duplicateAssets.length === 1 ? '' : 's'} for asset ${asset.id}`,
      );
      const result = await this.updateDuplicates(asset, duplicateAssets);
      assetIds = result.assetIds;
    } else if (asset.duplicateId) {
      this.logger.debug(`No duplicates found for asset ${asset.id}, removing duplicateId`);
      await this.assetRepository.update({ id: asset.id, duplicateId: null });
    }

    const duplicatesDetectedAt = new Date();
    await this.assetRepository.upsertJobStatus(...assetIds.map((assetId) => ({ assetId, duplicatesDetectedAt })));
    if (machineLearning.duplicateDetection.autoStack && asset.type === AssetType.Image) {
      await this.jobRepository.queue({ name: JobName.AssetAutoStackDuplicates, data: { id: asset.id } });
    }

    return JobStatus.Success;
  }

  private async updateDuplicates(
    asset: { id: string; duplicateId: string | null },
    duplicateAssets: AssetDuplicateResult[],
  ): Promise<{ assetIds: string[]; duplicateId: string }> {
    const duplicateIds = [
      ...new Set(
        duplicateAssets
          .filter((asset): asset is AssetDuplicateResult & { duplicateId: string } => !!asset.duplicateId)
          .map((duplicate) => duplicate.duplicateId),
      ),
    ];

    const targetDuplicateId = asset.duplicateId ?? duplicateIds.shift() ?? this.cryptoRepository.randomUUID();
    const assetIdsToUpdate = duplicateAssets
      .filter((asset) => asset.duplicateId !== targetDuplicateId)
      .map((duplicate) => duplicate.assetId);
    assetIdsToUpdate.push(asset.id);

    await this.duplicateRepository.merge({
      targetId: targetDuplicateId,
      assetIds: assetIdsToUpdate,
      sourceIds: duplicateIds,
    });
    return { assetIds: assetIdsToUpdate, duplicateId: targetDuplicateId };
  }

  @OnJob({ name: JobName.AssetAutoStackDuplicatesQueueAll, queue: QueueName.DuplicateDetection })
  async handleQueueAutoStackDuplicates(): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isDuplicateDetectionEnabled(machineLearning) || !machineLearning.duplicateDetection.autoStack) {
      return JobStatus.Skipped;
    }

    let jobs: JobItem[] = [];
    const queueAll = async () => {
      await this.jobRepository.queueAll(jobs);
      jobs = [];
    };

    for await (const { id } of this.duplicateRepository.streamForAutoStack()) {
      jobs.push({ name: JobName.AssetAutoStackDuplicates, data: { id } });
      if (jobs.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await queueAll();
      }
    }
    await queueAll();
    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetAutoStackDuplicates, queue: QueueName.DuplicateDetection })
  async handleAutoStackDuplicates({ id }: JobOf<JobName.AssetAutoStackDuplicates>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isDuplicateDetectionEnabled(machineLearning) || !machineLearning.duplicateDetection.autoStack) {
      return JobStatus.Skipped;
    }

    return this.autoStackDuplicates(id, machineLearning.duplicateDetection.autoStackThreshold);
  }

  private async autoStackDuplicates(id: string, threshold: number): Promise<JobStatus> {
    const seed = await this.duplicateRepository.getAutoStackSeed(id);
    if (!seed || seed.stackId || ![AssetVisibility.Archive, AssetVisibility.Timeline].includes(seed.visibility)) {
      this.logger.debug(`Auto-stack seed ${id} is no longer eligible or is already stacked`);
      return JobStatus.Skipped;
    }

    const seedFormat = getAutoStackFormat(seed.originalFileName);
    if (!seed.previewPath || seedFormat === undefined) {
      this.logger.debug(`Auto-stack seed ${id} is missing a preview or has an ineligible format`);
      return JobStatus.Skipped;
    }

    const candidateResults = await this.duplicateRepository.getAutoStackCandidates({
      assetId: seed.id,
      ownerId: seed.ownerId,
      duplicateId: seed.duplicateId,
      localDateTime: seed.localDateTime,
      dateTimeOriginal: seed.dateTimeOriginal,
    });
    const candidates = candidateResults
      .map((asset) => ({ ...asset, format: getAutoStackFormat(asset.originalFileName) }))
      .filter((asset): asset is typeof asset & { format: AutoStackFormat; previewPath: string } => {
        const isEligible =
          asset.format !== undefined &&
          !!asset.previewPath &&
          !asset.stackId &&
          [AssetVisibility.Archive, AssetVisibility.Timeline].includes(asset.visibility);
        if (!isEligible) {
          this.logger.debug(`Auto-stack candidate ${asset.id} is no longer eligible`);
          return false;
        }

        const hasDuplicateMatch = !!seed.duplicateId && asset.duplicateId === seed.duplicateId;
        const hasMetadataMatch = isWithinCaptureWindow(seed, asset) && hasMatchingCaptureIdentity(seed, asset);
        if (!hasDuplicateMatch && !hasMetadataMatch) {
          this.logger.debug(
            `Auto-stack candidate ${asset.id} rejected for seed ${id}: capture time or identity did not match`,
          );
          return false;
        }
        return true;
      });
    if (candidates.length === 0) {
      this.logger.debug(`No metadata or CLIP candidates found for auto-stack seed ${id}`);
      return JobStatus.Skipped;
    }

    candidates.push({ ...seed, format: seedFormat, previewPath: seed.previewPath });
    candidates.sort(compareAutoStackAssets);
    const assets: AutoStackAsset[] = await Promise.all(
      candidates.map(async (asset) => ({
        ...asset,
        hash: await this.mediaRepository.getPerceptualHash(asset.previewPath),
      })),
    );
    const components: AutoStackAsset[][] = [];
    for (const asset of assets) {
      const component = components.find((component) => {
        const distances = component.map((member) => ({
          id: member.id,
          distance: getHammingDistance(member.hash, asset.hash),
        }));
        const matches = distances.every(({ distance }) => distance <= threshold);
        if (!matches) {
          this.logger.debug(
            `Auto-stack asset ${asset.id} rejected from cluster [${component.map(({ id }) => id).join(', ')}]: ${distances.map(({ id, distance }) => `${id}=${distance}`).join(', ')} (threshold=${threshold})`,
          );
        }
        return matches;
      });
      if (component) {
        component.push(asset);
      } else {
        components.push([asset]);
      }
    }

    let created = 0;
    for (const component of components) {
      const ownerIds = new Set(component.map(({ ownerId }) => ownerId));
      if (ownerIds.size !== 1) {
        this.logger.warn(`Refusing to auto-stack duplicate group ${id} with assets from multiple owners`);
        continue;
      }

      const selectedFormats = new Set<AutoStackFormat>();
      const selected = component.filter((asset) => {
        if (selectedFormats.has(asset.format)) {
          return false;
        }
        selectedFormats.add(asset.format);
        return true;
      });
      if (selected.length < 2) {
        this.logger.debug(
          `Skipping auto-stack cluster [${component.map(({ id }) => id).join(', ')}]: fewer than two format categories`,
        );
        continue;
      }

      const createdStack = await this.databaseRepository.withLock(DatabaseLock.AutoStack, async () => {
        const currentAssets = await Promise.all(
          selected.map(({ id }) => this.duplicateRepository.getAutoStackSeed(id)),
        );
        if (
          currentAssets.some(
            (asset, index) =>
              !asset ||
              asset.stackId ||
              asset.ownerId !== selected[index].ownerId ||
              getAutoStackFormat(asset.originalFileName) !== selected[index].format,
          )
        ) {
          this.logger.debug(
            `Skipping auto-stack cluster [${selected.map(({ id }) => id).join(', ')}]: eligibility changed before creation`,
          );
          return false;
        }

        const stack = await this.stackRepository.create(
          { ownerId: selected[0].ownerId },
          selected.map(({ id }) => id),
          { clearDuplicateId: true },
        );
        await this.eventRepository.emit('StackCreate', { stackId: stack.id, userId: selected[0].ownerId });
        return true;
      });
      if (createdStack) {
        created++;
      }
    }

    return created > 0 ? JobStatus.Success : JobStatus.Skipped;
  }
}
