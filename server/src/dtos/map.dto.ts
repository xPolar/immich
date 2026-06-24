import { createZodDto } from 'nestjs-zod';
import { AssetTypeSchema } from 'src/enum';
import { isoDatetimeToDate, latitudeSchema, longitudeSchema, stringToBool } from 'src/validation';
import z from 'zod';

const MapReverseGeocodeSchema = z
  .object({
    lat: z.coerce.number().meta({ format: 'double' }).pipe(latitudeSchema).describe('Latitude (-90 to 90)'),
    lon: z.coerce.number().meta({ format: 'double' }).pipe(longitudeSchema).describe('Longitude (-180 to 180)'),
  })
  .meta({ id: 'MapReverseGeocodeDto' });

const MapReverseGeocodeResponseSchema = z
  .object({
    city: z.string().nullable().describe('City name'),
    state: z.string().nullable().describe('State/Province name'),
    country: z.string().nullable().describe('Country name'),
  })
  .meta({ id: 'MapReverseGeocodeResponseDto' });

const uuidArrayQuery = z
  .preprocess(
    (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
    z.array(z.uuidv4()),
  )
  .optional();

const MapMarkerSchema = z
  .object({
    isArchived: stringToBool.optional().describe('Filter by archived status'),
    isFavorite: stringToBool.optional().describe('Filter by favorite status'),
    fileCreatedAfter: isoDatetimeToDate.optional().describe('Filter assets created after this date'),
    fileCreatedBefore: isoDatetimeToDate.optional().describe('Filter assets created before this date'),
    takenAfter: isoDatetimeToDate.optional().describe('Filter assets taken after this date'),
    takenBefore: isoDatetimeToDate.optional().describe('Filter assets taken before this date'),
    personIds: uuidArrayQuery.describe('Filter by person IDs'),
    tagIds: uuidArrayQuery.describe('Filter by tag IDs'),
    make: z.string().optional().describe('Filter by camera make'),
    model: z.string().optional().describe('Filter by camera model'),
    lensModel: z.string().optional().describe('Filter by lens model'),
    rating: z.coerce.number().int().min(1).max(5).optional().describe('Filter by minimum rating'),
    isUnrated: stringToBool.optional().describe('Filter to unrated assets'),
    type: AssetTypeSchema.optional().describe('Filter by asset type'),
    withPartners: stringToBool.optional().describe('Include partner assets'),
    withSharedAlbums: stringToBool.optional().describe('Include shared album assets'),
  })
  .meta({ id: 'MapMarkerDto' });

const MapMarkerResponseSchema = z
  .object({
    id: z.uuidv4().describe('Asset ID'),
    lat: z.number().meta({ format: 'double' }).describe('Latitude'),
    lon: z.number().meta({ format: 'double' }).describe('Longitude'),
    city: z.string().nullable().describe('City name'),
    state: z.string().nullable().describe('State/Province name'),
    country: z.string().nullable().describe('Country name'),
  })
  .meta({ id: 'MapMarkerResponseDto' });

export class MapReverseGeocodeDto extends createZodDto(MapReverseGeocodeSchema) {}
export class MapReverseGeocodeResponseDto extends createZodDto(MapReverseGeocodeResponseSchema) {}
export class MapMarkerDto extends createZodDto(MapMarkerSchema) {}
export class MapMarkerResponseDto extends createZodDto(MapMarkerResponseSchema) {}
