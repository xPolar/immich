import { StackController } from 'src/controllers/stack.controller';
import { SharedLinkType } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository';
import { StackRepository } from 'src/repositories/stack.repository';
import { AuthService } from 'src/services/auth.service';
import { StackService } from 'src/services/stack.service';
import request from 'supertest';
import { newMediumService } from 'test/medium.factory';
import { ControllerContext, controllerSetup, getKyselyDB } from 'test/utils';

describe('StackController shared links', () => {
  let http: ControllerContext;
  let stackId: string;
  let primaryAssetId: string;
  let secondaryAssetId: string;
  let unrelatedStackId: string;
  const key = Buffer.from('shared-album-stack-http-test');
  const slug = 'shared-album-stack-http-test';

  beforeAll(async () => {
    const database = await getKyselyDB();
    const { sut: stackService, ctx } = newMediumService(StackService, {
      database,
      real: [AccessRepository, StackRepository],
      mock: [LoggingRepository],
    });
    const { sut: authService } = newMediumService(AuthService, {
      database,
      real: [SharedLinkRepository],
      mock: [LoggingRepository],
    });
    const { user } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: user.id });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: secondary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: unrelatedPrimary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: unrelatedSecondary } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newExif({ assetId: primary.id, make: 'Canon' });
    await ctx.newExif({ assetId: secondary.id, make: 'Canon' });
    const { stack } = await ctx.newStack({ ownerId: user.id }, [primary.id, secondary.id]);
    const { stack: unrelatedStack } = await ctx.newStack({ ownerId: user.id }, [
      unrelatedPrimary.id,
      unrelatedSecondary.id,
    ]);
    stackId = stack.id;
    primaryAssetId = primary.id;
    secondaryAssetId = secondary.id;
    unrelatedStackId = unrelatedStack.id;
    await ctx.newAlbumAsset({ albumId: album.id, assetId: primary.id });
    await ctx.get(SharedLinkRepository).create({
      key,
      slug,
      type: SharedLinkType.Album,
      userId: user.id,
      albumId: album.id,
      allowUpload: false,
      showExif: false,
    });
    http = await controllerSetup(StackController, [
      { provide: StackService, useValue: stackService },
      { provide: AuthService, useValue: authService },
    ]);
  });

  afterAll(async () => {
    await http?.close();
  });

  it.each([
    { query: { key: key.toString('base64url') }, headers: {} },
    { query: { slug }, headers: {} },
    { query: {}, headers: { 'x-immich-share-key': key.toString('base64url') } },
    { query: {}, headers: { 'x-immich-share-slug': slug } },
  ])('returns the stack to a shared-link visitor using $query $headers', async ({ query, headers }) => {
    const { status, body } = await request(http.getHttpServer()).get(`/stacks/${stackId}`).query(query).set(headers);

    expect(status).toBe(200);
    expect(body).toEqual({
      id: stackId,
      primaryAssetId,
      assets: [
        expect.objectContaining({ id: primaryAssetId, hasMetadata: false }),
        expect.objectContaining({ id: secondaryAssetId, hasMetadata: false }),
      ],
    });
    for (const asset of body.assets) {
      expect(asset).not.toHaveProperty('originalFileName');
      expect(asset).not.toHaveProperty('exifInfo');
    }
  });

  it('rejects unauthenticated visitors', async () => {
    const { status } = await request(http.getHttpServer()).get(`/stacks/${stackId}`);
    expect(status).toBe(401);
  });

  it('rejects invalid shared links', async () => {
    const { status } = await request(http.getHttpServer()).get(`/stacks/${stackId}`).query({ key: 'invalid-key' });
    expect(status).toBe(401);
  });

  it('rejects stacks outside the shared album', async () => {
    const { status } = await request(http.getHttpServer())
      .get(`/stacks/${unrelatedStackId}`)
      .query({ key: key.toString('base64url') });
    expect(status).toBe(400);
  });

  it('does not allow shared-link visitors to search all stacks', async () => {
    const { status } = await request(http.getHttpServer())
      .get('/stacks')
      .query({ key: key.toString('base64url') });
    expect(status).toBe(403);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('does not allow %s stack mutations', async (method) => {
    const client = request(http.getHttpServer());
    const { status } = await client[method](method === 'post' ? '/stacks' : `/stacks/${stackId}`)
      .query({ key: key.toString('base64url') })
      .send({ assetIds: [primaryAssetId, secondaryAssetId], primaryAssetId: secondaryAssetId });
    expect(status).toBe(403);
  });
});
