import { describe, it, expect } from 'vitest';
import { extractImageMetadata } from '../media/metadata';

// --- Minimal real JPEG+EXIF buffer builder, used to exercise the REAL exifr.parse (no mock) ---
// Layout is a bare-bones TIFF/EXIF structure: IFD0 (Orientation, Exif IFD ptr, GPS IFD ptr),
// an Exif SubIFD (DateTimeOriginal), and a GPS IFD (lat/lon ref + DMS rationals), wrapped in a
// single JPEG APP1 segment. All offsets below are computed from the actual sizes of the
// preceding sections rather than hardcoded, to avoid layout arithmetic errors.
function writeIfdEntry(
  buf: Buffer,
  offset: number,
  tag: number,
  type: number,
  count: number,
  value: number,
): number {
  buf.writeUInt16LE(tag, offset);
  buf.writeUInt16LE(type, offset + 2);
  buf.writeUInt32LE(count, offset + 4);
  buf.writeUInt32LE(value, offset + 8);
  return offset + 12;
}

function writeRational(buf: Buffer, offset: number, numerator: number, denominator: number): void {
  buf.writeUInt32LE(numerator, offset);
  buf.writeUInt32LE(denominator, offset + 4);
}

/**
 * Builds a real JPEG buffer with embedded EXIF: GPS coordinates (40.7128, -74.006),
 * DateTimeOriginal 2026-01-15 10:30:00 (local, per EXIF's timezone-less format), and
 * Orientation = 6 ("Rotate 90 CW" when translated, but must come back as the raw number 6).
 */
function buildJpegWithExif(): Buffer {
  const HEADER_SIZE = 8;
  const ifd0Offset = HEADER_SIZE;
  const ifd0EntryCount = 3;
  const ifd0Size = 2 + ifd0EntryCount * 12 + 4;
  const exifIfdOffset = ifd0Offset + ifd0Size;
  const exifIfdEntryCount = 1;
  const exifIfdSize = 2 + exifIfdEntryCount * 12 + 4;
  const dateTimeStr = '2026:01:15 10:30:00\0';
  const dateTimeOffset = exifIfdOffset + exifIfdSize;
  const dateTimeSize = dateTimeStr.length;
  const gpsIfdOffset = dateTimeOffset + dateTimeSize;
  const gpsIfdEntryCount = 4;
  const gpsIfdSize = 2 + gpsIfdEntryCount * 12 + 4;
  const gpsLatOffset = gpsIfdOffset + gpsIfdSize;
  const gpsLatSize = 3 * 8;
  const gpsLonOffset = gpsLatOffset + gpsLatSize;
  const gpsLonSize = 3 * 8;
  const tiffSize = gpsLonOffset + gpsLonSize;

  const tiff = Buffer.alloc(tiffSize);

  // TIFF header: little-endian byte order, magic 42, offset to IFD0.
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0Offset, 4);

  // IFD0: Orientation, Exif IFD pointer, GPS IFD pointer.
  let o = ifd0Offset;
  tiff.writeUInt16LE(ifd0EntryCount, o);
  o += 2;
  o = writeIfdEntry(tiff, o, 0x0112, 3, 1, 6); // Orientation (SHORT) = 6
  o = writeIfdEntry(tiff, o, 0x8769, 4, 1, exifIfdOffset); // Exif IFD pointer (LONG)
  o = writeIfdEntry(tiff, o, 0x8825, 4, 1, gpsIfdOffset); // GPS IFD pointer (LONG)
  tiff.writeUInt32LE(0, o); // next IFD offset: none

  // Exif SubIFD: DateTimeOriginal.
  o = exifIfdOffset;
  tiff.writeUInt16LE(exifIfdEntryCount, o);
  o += 2;
  o = writeIfdEntry(tiff, o, 0x9003, 2, dateTimeSize, dateTimeOffset); // DateTimeOriginal (ASCII)
  tiff.writeUInt32LE(0, o); // next IFD offset: none
  tiff.write(dateTimeStr, dateTimeOffset, 'ascii');

  // GPS IFD: LatRef, Lat (DMS rational triple), LonRef, Lon (DMS rational triple).
  o = gpsIfdOffset;
  tiff.writeUInt16LE(gpsIfdEntryCount, o);
  o += 2;
  o = writeIfdEntry(tiff, o, 0x0001, 2, 2, 'N'.charCodeAt(0)); // GPSLatitudeRef
  o = writeIfdEntry(tiff, o, 0x0002, 5, 3, gpsLatOffset); // GPSLatitude
  o = writeIfdEntry(tiff, o, 0x0003, 2, 2, 'W'.charCodeAt(0)); // GPSLongitudeRef
  o = writeIfdEntry(tiff, o, 0x0004, 5, 3, gpsLonOffset); // GPSLongitude
  tiff.writeUInt32LE(0, o); // next IFD offset: none

  // 40 deg, 42 min, 46.08 sec N => 40 + 42/60 + 46.08/3600 = 40.7128
  writeRational(tiff, gpsLatOffset, 40, 1);
  writeRational(tiff, gpsLatOffset + 8, 42, 1);
  writeRational(tiff, gpsLatOffset + 16, 4608, 100);

  // 74 deg, 0 min, 21.6 sec W => -(74 + 0/60 + 21.6/3600) = -74.006
  writeRational(tiff, gpsLonOffset, 74, 1);
  writeRational(tiff, gpsLonOffset + 8, 0, 1);
  writeRational(tiff, gpsLonOffset + 16, 216, 10);

  const exifHeader = Buffer.from('Exif\0\0', 'ascii');
  const app1Payload = Buffer.concat([exifHeader, tiff]);
  const app1LengthBuf = Buffer.alloc(2);
  app1LengthBuf.writeUInt16BE(app1Payload.length + 2, 0); // length field includes itself

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    Buffer.from([0xff, 0xe1]), // APP1 marker
    app1LengthBuf,
    app1Payload,
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

describe('extractImageMetadata', () => {
  it('extracts GPS/date/orientation from a real EXIF-bearing JPEG via the real exifr.parse (no injected mock)', async () => {
    const jpeg = buildJpegWithExif();
    // No second argument: this exercises the real `exifr.parse` default, not the test's fake.
    const metadata = await extractImageMetadata(jpeg as unknown as Blob);

    expect(metadata.latitude).toBe(40.7128);
    expect(metadata.longitude).toBe(-74.006);
    expect(metadata.orientation).toBe(6);
    // DateTimeOriginal has no timezone in EXIF; exifr revives it as a local Date, so we
    // compare against the same local interpretation instead of hardcoding an offset.
    expect(metadata.captureTime).toBe(new Date(2026, 0, 15, 10, 30, 0).toISOString());
  });

  it('extracts GPS coordinates when present', async () => {
    const fakeParse = async () => ({ latitude: 40.7128, longitude: -74.006 });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.latitude).toBe(40.7128);
    expect(metadata.longitude).toBe(-74.006);
  });

  it('omits GPS fields when absent, without treating it as an error', async () => {
    const fakeParse = async () => ({});
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.latitude).toBeUndefined();
    expect(metadata.longitude).toBeUndefined();
  });

  it('omits GPS fields when only latitude is present (both are required, not just one)', async () => {
    const fakeParse = async () => ({ latitude: 40.7128 });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.latitude).toBeUndefined();
    expect(metadata.longitude).toBeUndefined();
  });

  it('converts DateTimeOriginal to an ISO capture time string', async () => {
    const date = new Date('2026-01-15T10:30:00.000Z');
    const fakeParse = async () => ({ DateTimeOriginal: date });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.captureTime).toBe('2026-01-15T10:30:00.000Z');
  });

  it('passes through orientation when present', async () => {
    const fakeParse = async () => ({ Orientation: 6 });
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata.orientation).toBe(6);
  });

  it('returns an empty object when parseExif throws (corrupt file)', async () => {
    const fakeParse = async (): Promise<never> => {
      throw new Error('corrupt EXIF');
    };
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata).toEqual({});
  });

  it('returns an empty object when parseExif resolves undefined', async () => {
    const fakeParse = async () => undefined;
    const metadata = await extractImageMetadata(new Blob(), fakeParse);
    expect(metadata).toEqual({});
  });
});
