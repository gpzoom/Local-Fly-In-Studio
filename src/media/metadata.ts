import exifr from 'exifr';

export interface ExtractedMediaMetadata {
  latitude?: number;
  longitude?: number;
  captureTime?: string;
  orientation?: number;
}

interface ExifParseResult {
  latitude?: number;
  longitude?: number;
  DateTimeOriginal?: Date;
  Orientation?: number;
}

export type ParseExifFn = (
  file: File | Blob,
  options?: unknown,
) => Promise<ExifParseResult | undefined>;

export async function extractImageMetadata(
  file: File | Blob,
  parseExif: ParseExifFn = exifr.parse as ParseExifFn,
): Promise<ExtractedMediaMetadata> {
  let result: ExifParseResult | undefined;
  try {
    result = await parseExif(file, { gps: true, tiff: true, exif: true });
  } catch {
    return {};
  }

  if (!result) return {};

  const metadata: ExtractedMediaMetadata = {};

  if (
    typeof result.latitude === 'number' &&
    Number.isFinite(result.latitude) &&
    typeof result.longitude === 'number' &&
    Number.isFinite(result.longitude)
  ) {
    metadata.latitude = result.latitude;
    metadata.longitude = result.longitude;
  }

  if (result.DateTimeOriginal instanceof Date && !Number.isNaN(result.DateTimeOriginal.getTime())) {
    metadata.captureTime = result.DateTimeOriginal.toISOString();
  }

  if (typeof result.Orientation === 'number') {
    metadata.orientation = result.Orientation;
  }

  return metadata;
}
