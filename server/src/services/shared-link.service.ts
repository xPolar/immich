import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PostgresError } from 'postgres';
import { AssetIdErrorReason, AssetIdsResponseDto } from 'src/dtos/asset-ids.response.dto';
import { AssetIdsDto } from 'src/dtos/asset.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  mapSharedLink,
  SharedLinkCreateDto,
  SharedLinkEditDto,
  SharedLinkLoginDto,
  SharedLinkResponseDto,
  SharedLinkSearchDto,
  SharedLinkViewPeriod,
  SharedLinkViewResponseDto,
} from 'src/dtos/shared-link.dto';
import { Permission, SharedLinkType } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { getExternalDomain, OpenGraphTags } from 'src/utils/misc';

@Injectable()
export class SharedLinkService extends BaseService {
  createVisitorId() {
    return this.cryptoRepository.randomBytes(32).toString('base64url');
  }

  async trackView(auth: AuthDto, authTokens: string[], visitorId: string): Promise<void> {
    if (!auth.sharedLink) {
      throw new ForbiddenException();
    }

    const { id, password } = auth.sharedLink;
    if (password && !authTokens.includes(this.asToken({ id, password }))) {
      throw new UnauthorizedException('Password required');
    }

    const visitorHash = this.cryptoRepository.hashSha256(`${id}:${visitorId}`);
    await this.sharedLinkRepository.trackView(id, visitorHash, new Date());
  }

  async getViewAnalytics(auth: AuthDto, id: string, period: SharedLinkViewPeriod): Promise<SharedLinkViewResponseDto> {
    await this.findOrFail(auth.user.id, id);
    const days = period === SharedLinkViewPeriod.Days30 ? 30 : period === SharedLinkViewPeriod.Days90 ? 90 : undefined;
    const startDate = days ? new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000) : undefined;
    startDate?.setUTCHours(0, 0, 0, 0);
    const analytics = await this.sharedLinkRepository.getViewAnalytics(id, startDate);
    if (!days || !startDate) {
      return analytics;
    }

    const byDate = new Map(analytics.daily.map((item) => [item.date, item]));
    const daily = Array.from({ length: days }, (_, index) => {
      const date = new Date(startDate);
      date.setUTCDate(date.getUTCDate() + index);
      const dateString = date.toISOString().slice(0, 10);
      return byDate.get(dateString) || { date: dateString, views: 0, uniqueBrowsers: 0 };
    });

    return { ...analytics, daily };
  }

  async getAll(auth: AuthDto, { id, albumId }: SharedLinkSearchDto): Promise<SharedLinkResponseDto[]> {
    return this.sharedLinkRepository
      .getAll({ userId: auth.user.id, id, albumId })
      .then((links) => links.map((link) => mapSharedLink(link, { stripAssetMetadata: false })));
  }

  async login(auth: AuthDto, dto: SharedLinkLoginDto) {
    if (!auth.sharedLink) {
      throw new ForbiddenException();
    }

    const sharedLink = await this.findOrFail(auth.user.id, auth.sharedLink.id);
    const { id, password } = sharedLink;

    if (!password) {
      throw new BadRequestException('Shared link is not password protected');
    }

    if (password !== dto.password) {
      throw new UnauthorizedException('Invalid password');
    }

    return {
      sharedLink: mapSharedLink(sharedLink, { stripAssetMetadata: !sharedLink.showExif }),
      token: this.asToken({ id, password }),
    };
  }

  async getMine(auth: AuthDto, authTokens: string[]) {
    if (!auth.sharedLink) {
      throw new ForbiddenException();
    }

    const sharedLink = await this.findOrFail(auth.user.id, auth.sharedLink.id);
    const { id, password } = sharedLink;

    if (password && !authTokens.includes(this.asToken({ id, password }))) {
      throw new UnauthorizedException('Password required');
    }

    return mapSharedLink(sharedLink, { stripAssetMetadata: !sharedLink.showExif });
  }

  async get(auth: AuthDto, id: string): Promise<SharedLinkResponseDto> {
    const sharedLink = await this.findOrFail(auth.user.id, id);
    return mapSharedLink(sharedLink, { stripAssetMetadata: false });
  }

  async create(auth: AuthDto, dto: SharedLinkCreateDto): Promise<SharedLinkResponseDto> {
    switch (dto.type) {
      case SharedLinkType.Album: {
        if (!dto.albumId) {
          throw new BadRequestException('Invalid albumId');
        }
        await this.requireAccess({ auth, permission: Permission.AlbumShare, ids: [dto.albumId] });
        break;
      }

      case SharedLinkType.Individual: {
        if (!dto.assetIds || dto.assetIds.length === 0) {
          throw new BadRequestException('Invalid assetIds');
        }

        await this.requireAccess({ auth, permission: Permission.AssetShare, ids: dto.assetIds });

        break;
      }
    }

    try {
      const sharedLink = await this.sharedLinkRepository.create({
        key: this.cryptoRepository.randomBytes(50),
        userId: auth.user.id,
        type: dto.type,
        albumId: dto.albumId || null,
        assetIds: dto.assetIds,
        description: dto.description || null,
        password: dto.password,
        expiresAt: dto.expiresAt || null,
        allowUpload: dto.allowUpload ?? true,
        allowDownload: dto.showMetadata === false ? false : (dto.allowDownload ?? true),
        showExif: dto.showMetadata ?? true,
        slug: dto.slug || null,
      });

      return mapSharedLink(sharedLink, { stripAssetMetadata: false });
    } catch (error) {
      this.handleError(error);
    }
  }

  private handleError(error: unknown): never {
    if ((error as PostgresError).constraint_name === 'shared_link_slug_uq') {
      this.logger.debug('Shared link with this slug already exists');
      throw new BadRequestException('Failed to save shared link');
    }
    throw error;
  }

  async update(auth: AuthDto, id: string, dto: SharedLinkEditDto) {
    await this.findOrFail(auth.user.id, id);
    try {
      const sharedLink = await this.sharedLinkRepository.update({
        id,
        userId: auth.user.id,
        description: dto.description,
        password: dto.password,
        expiresAt: dto.expiresAt,
        allowUpload: dto.allowUpload,
        allowDownload: dto.allowDownload,
        showExif: dto.showMetadata,
        slug: dto.slug || null,
      });
      return mapSharedLink(sharedLink, { stripAssetMetadata: false });
    } catch (error) {
      this.handleError(error);
    }
  }

  async remove(auth: AuthDto, id: string): Promise<void> {
    const sharedLink = await this.findOrFail(auth.user.id, id);
    await this.sharedLinkRepository.remove(sharedLink.id);
  }

  // TODO: replace `userId` with permissions and access control checks
  private async findOrFail(userId: string, id: string) {
    const sharedLink = await this.sharedLinkRepository.get(userId, id);
    if (!sharedLink) {
      throw new BadRequestException('Shared link not found');
    }
    return sharedLink;
  }

  async addAssets(auth: AuthDto, id: string, dto: AssetIdsDto): Promise<AssetIdsResponseDto[]> {
    const sharedLink = await this.findOrFail(auth.user.id, id);
    if (sharedLink.type !== SharedLinkType.Individual) {
      throw new BadRequestException('Invalid shared link type');
    }

    const existingAssetIds = new Set(sharedLink.assets.map((asset) => asset.id));
    const notPresentAssetIds = dto.assetIds.filter((assetId) => !existingAssetIds.has(assetId));
    const allowedAssetIds = await this.checkAccess({
      auth,
      permission: Permission.AssetShare,
      ids: notPresentAssetIds,
    });

    const results: AssetIdsResponseDto[] = [];
    for (const assetId of dto.assetIds) {
      const hasAsset = existingAssetIds.has(assetId);
      if (hasAsset) {
        results.push({ assetId, success: false, error: AssetIdErrorReason.DUPLICATE });
        continue;
      }

      const hasAccess = allowedAssetIds.has(assetId);
      if (!hasAccess) {
        results.push({ assetId, success: false, error: AssetIdErrorReason.NO_PERMISSION });
        continue;
      }

      results.push({ assetId, success: true });
    }

    await this.sharedLinkRepository.update({
      ...sharedLink,
      assetIds: results.filter(({ success }) => success).map(({ assetId }) => assetId),
    });

    return results;
  }

  async removeAssets(auth: AuthDto, id: string, dto: AssetIdsDto): Promise<AssetIdsResponseDto[]> {
    const sharedLink = await this.findOrFail(auth.user.id, id);

    if (sharedLink.type !== SharedLinkType.Individual) {
      throw new BadRequestException('Invalid shared link type');
    }

    const removedAssetIds = await this.sharedLinkAssetRepository.remove(id, dto.assetIds);

    const results: AssetIdsResponseDto[] = [];
    for (const assetId of dto.assetIds) {
      const wasRemoved = removedAssetIds.find((id) => id === assetId);
      if (!wasRemoved) {
        results.push({ assetId, success: false, error: AssetIdErrorReason.NOT_FOUND });
        continue;
      }

      results.push({ assetId, success: true });
      sharedLink.assets = sharedLink.assets.filter((asset) => asset.id !== assetId);
    }

    await this.sharedLinkRepository.update(sharedLink);

    return results;
  }

  async getMetadataTags(auth: AuthDto, defaultDomain?: string): Promise<null | OpenGraphTags> {
    if (!auth.sharedLink || auth.sharedLink.password) {
      return null;
    }

    const config = await this.getConfig({ withCache: true });
    const sharedLink = await this.findOrFail(auth.sharedLink.userId, auth.sharedLink.id);
    const assetId = sharedLink.album?.albumThumbnailAssetId || sharedLink.assets[0]?.id;
    const assetCount = sharedLink.assets.length > 0 ? sharedLink.assets.length : sharedLink.album?.assets?.length || 0;
    const imagePath = assetId
      ? `/api/assets/${assetId}/thumbnail?key=${sharedLink.key.toString('base64url')}`
      : '/feature-panel.png';

    return {
      title: sharedLink.album ? sharedLink.album.albumName : 'Public Share',
      description: sharedLink.description || `${assetCount} shared photos & videos`,
      imageUrl: new URL(imagePath, getExternalDomain(config.server, defaultDomain)).href,
    };
  }

  private asToken(sharedLink: { id: string; password: string }) {
    return this.cryptoRepository.hashSha256(`${sharedLink.id}-${sharedLink.password}`).toString('base64');
  }
}
