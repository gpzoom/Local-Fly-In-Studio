export interface VideoMetadata {
  durationMs: number;
  width: number;
  height: number;
}

async function defaultLoadMetadata(file: File | Blob): Promise<VideoMetadata> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  try {
    return await new Promise<VideoMetadata>((resolve, reject) => {
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve({
          durationMs: video.duration * 1000,
          width: video.videoWidth,
          height: video.videoHeight,
        });
      };
      video.onerror = () => {
        reject(new Error('Could not read video metadata'));
      };
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function extractVideoMetadata(
  file: File | Blob,
  loadMetadata: (file: File | Blob) => Promise<VideoMetadata> = defaultLoadMetadata,
): Promise<VideoMetadata> {
  return loadMetadata(file);
}
