import { AssetMediaResponseDto, getAssetDuplicates, LoginResponseDto, searchStacks, updateAssets } from '@immich/sdk';
import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import { asBearerAuth, utils } from 'src/utils';

test.describe('Duplicates Utility', () => {
  let admin: LoginResponseDto;
  let firstAsset: AssetMediaResponseDto;
  let secondAsset: AssetMediaResponseDto;

  test.beforeAll(async () => {
    utils.initSdk();
    await utils.resetDatabase();
    admin = await utils.adminSetup();
  });

  test.beforeEach(async ({ context }) => {
    await utils.resetDatabase(['stack', 'asset']);
    [firstAsset, secondAsset] = await Promise.all([
      utils.createAsset(admin.accessToken, {}),
      utils.createAsset(admin.accessToken, {}),
    ]);

    await updateAssets(
      {
        assetBulkUpdateDto: {
          ids: [firstAsset.id, secondAsset.id],
          duplicateId: crypto.randomUUID(),
        },
      },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await utils.setAuthCookies(context, admin.accessToken);
  });

  test('navigates with arrow keys between duplicate preview assets', async ({ page }) => {
    await page.goto('/utilities/duplicates');
    await page.getByRole('button', { name: 'View' }).first().click();
    await page.waitForSelector('#immich-asset-viewer');

    const getViewedAssetId = () => new URL(page.url()).pathname.split('/').at(-1) ?? '';
    const initialAssetId = getViewedAssetId();
    expect([firstAsset.id, secondAsset.id]).toContain(initialAssetId);

    await page.keyboard.press('ArrowRight');
    await expect.poll(getViewedAssetId).not.toBe(initialAssetId);

    await page.keyboard.press('ArrowLeft');
    await expect.poll(getViewedAssetId).toBe(initialAssetId);
  });

  test('stacks every duplicate group into a separate stack', async ({ page }) => {
    const [thirdAsset, fourthAsset] = await Promise.all([
      utils.createAsset(admin.accessToken, {}),
      utils.createAsset(admin.accessToken, {}),
    ]);
    await updateAssets(
      {
        assetBulkUpdateDto: {
          ids: [thirdAsset.id, fourthAsset.id],
          duplicateId: crypto.randomUUID(),
        },
      },
      { headers: asBearerAuth(admin.accessToken) },
    );

    await page.goto('/utilities/duplicates');
    await page.getByRole('button', { name: 'Stack All' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('No duplicates found')).toBeVisible();

    const [duplicates, stacks] = await Promise.all([
      getAssetDuplicates({ headers: asBearerAuth(admin.accessToken) }),
      searchStacks({}, { headers: asBearerAuth(admin.accessToken) }),
    ]);
    expect(duplicates).toEqual([]);
    expect(stacks).toHaveLength(2);
    expect(stacks.map(({ assets }) => assets.map(({ id }) => id).toSorted())).toEqual(
      expect.arrayContaining([[firstAsset.id, secondAsset.id].toSorted(), [thirdAsset.id, fourthAsset.id].toSorted()]),
    );
  });
});
