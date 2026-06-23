import { MapMarkerDto } from 'src/dtos/map.dto';
import { AssetType } from 'src/enum';

describe(MapMarkerDto.name, () => {
  it('should parse content filters from query parameters', () => {
    const personId = '11111111-1111-4111-8111-111111111111';
    const tagId = '22222222-2222-4222-8222-222222222222';

    const result = MapMarkerDto.schema.safeParse({
      personIds: personId,
      tagIds: [tagId],
      make: 'Canon',
      model: 'EOS R5',
      lensModel: 'RF24-70mm',
      rating: '4',
      type: AssetType.Image,
      takenAfter: '2024-01-01T00:00:00.000Z',
      takenBefore: '2024-12-31T23:59:59.999Z',
      isFavorite: 'true',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      personIds: [personId],
      tagIds: [tagId],
      make: 'Canon',
      model: 'EOS R5',
      lensModel: 'RF24-70mm',
      rating: 4,
      type: AssetType.Image,
      takenAfter: new Date('2024-01-01T00:00:00.000Z'),
      takenBefore: new Date('2024-12-31T23:59:59.999Z'),
      isFavorite: true,
    });
  });

  it.each([
    [{ personIds: 'not-a-uuid' }],
    [{ tagIds: 'not-a-uuid' }],
    [{ rating: '0' }],
    [{ rating: '6' }],
    [{ type: 'DOCUMENT' }],
  ])('should reject invalid content filters: %j', (input) => {
    expect(MapMarkerDto.schema.safeParse(input).success).toBe(false);
  });
});
