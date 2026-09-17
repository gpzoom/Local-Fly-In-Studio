export interface CodecSelection {
  mimeType: string;
  fileExtension: string;
}

const CANDIDATES: CodecSelection[] = [
  { mimeType: 'video/mp4;codecs=avc1', fileExtension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', fileExtension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', fileExtension: 'webm' },
  { mimeType: 'video/webm', fileExtension: 'webm' },
];

export function selectExportMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): CodecSelection | null {
  const check =
    isTypeSupported ??
    (typeof MediaRecorder !== 'undefined'
      ? (mimeType: string) => MediaRecorder.isTypeSupported(mimeType)
      : () => false);

  for (const candidate of CANDIDATES) {
    if (check(candidate.mimeType)) return candidate;
  }
  return null;
}
