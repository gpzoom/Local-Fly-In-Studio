const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];
const HEIC_EXTENSIONS = ['.heic', '.heif'];

export function isHeic(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  if (HEIC_MIME_TYPES.includes(mimeType)) return true;

  const name = file.name.toLowerCase();
  return HEIC_EXTENSIONS.some((ext) => name.endsWith(ext));
}

async function defaultDecodeCheck(file: File): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

export async function canDecodeNatively(
  file: File,
  decodeCheck: (file: File) => Promise<boolean> = defaultDecodeCheck,
): Promise<boolean> {
  return decodeCheck(file);
}

export type HeicConversionResult = { ok: true; blob: Blob } | { ok: false; error: string };

async function defaultHeic2AnyConvert(file: File): Promise<Blob> {
  // Lazily imported: heic2any accesses browser globals (e.g. `window`) at
  // module load time, so it must not be evaluated in non-browser (test) runs
  // that never exercise this default conversion path.
  const { default: heic2any } = await import('heic2any');
  const result = await heic2any({ blob: file, toType: 'image/jpeg' });
  return Array.isArray(result) ? result[0] : result;
}

export async function convertHeicToJpeg(
  file: File,
  convert: (file: File) => Promise<Blob> = defaultHeic2AnyConvert,
): Promise<HeicConversionResult> {
  try {
    const blob = await convert(file);
    return { ok: true, blob };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown HEIC conversion error';
    return { ok: false, error: `Could not convert HEIC image: ${message}` };
  }
}
