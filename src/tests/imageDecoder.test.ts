import { describe, it, expect } from 'vitest';
import { isHeic, canDecodeNatively, convertHeicToJpeg } from '../media/imageDecoder';

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('isHeic', () => {
  it('returns true for image/heic MIME type', () => {
    expect(isHeic(makeFile('photo.heic', 'image/heic'))).toBe(true);
  });

  it('returns true for image/heif MIME type', () => {
    expect(isHeic(makeFile('photo.heif', 'image/heif'))).toBe(true);
  });

  it('returns true based on .heic extension when MIME type is empty', () => {
    expect(isHeic(makeFile('IMG_1234.HEIC', ''))).toBe(true);
  });

  it('returns false for JPEG, PNG, and WebP', () => {
    expect(isHeic(makeFile('photo.jpg', 'image/jpeg'))).toBe(false);
    expect(isHeic(makeFile('photo.png', 'image/png'))).toBe(false);
    expect(isHeic(makeFile('photo.webp', 'image/webp'))).toBe(false);
  });
});

describe('canDecodeNatively', () => {
  it('returns true when the injected decode check succeeds', async () => {
    const result = await canDecodeNatively(makeFile('a.heic', 'image/heic'), async () => true);
    expect(result).toBe(true);
  });

  it('returns false when the injected decode check fails', async () => {
    const result = await canDecodeNatively(makeFile('a.heic', 'image/heic'), async () => false);
    expect(result).toBe(false);
  });
});

describe('convertHeicToJpeg', () => {
  it('returns ok:true with the converted blob on success', async () => {
    const jpegBlob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' });
    const result = await convertHeicToJpeg(makeFile('a.heic', 'image/heic'), async () => jpegBlob);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.blob).toBe(jpegBlob);
    }
  });

  it('returns ok:false with a human-readable error instead of throwing', async () => {
    const failingConvert = async (): Promise<Blob> => {
      throw new Error('decode failed');
    };
    const result = await convertHeicToJpeg(makeFile('a.heic', 'image/heic'), failingConvert);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('decode failed');
    }
  });
});
