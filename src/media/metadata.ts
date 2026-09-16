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
    // translateValues: false is required so exifr returns Orientation as its raw numeric
    // EXIF value (e.g. 6) instead of a translated human-readable string (e.g. "Rotate 90 CW").
    // latitude/longitude and DateTimeOriginal are unaffected by this option.
    result = await parseExif(file, { gps: true, tiff: true, exif: true, translateValues: false });
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
