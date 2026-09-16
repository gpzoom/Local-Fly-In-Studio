export interface StorageCapabilities {
  opfsSupported: boolean;
}

export async function detectStorageCapabilities(): Promise<StorageCapabilities> {
  const opfsSupported =
    typeof navigator !== 'undefined' &&
    typeof navigator.storage !== 'undefined' &&
    typeof navigator.storage.getDirectory === 'function';
  return { opfsSupported };
}

export interface QuotaCheckResult {
  sufficient: boolean;
  quotaBytes: number | null;
  usageBytes: number | null;
  availableBytes: number | null;
}

export async function checkQuota(estimatedBytes: number): Promise<QuotaCheckResult> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.storage === 'undefined' ||
    typeof navigator.storage.estimate !== 'function'
  ) {
    return { sufficient: true, quotaBytes: null, usageBytes: null, availableBytes: null };
  }

  const { quota, usage } = await navigator.storage.estimate();
  if (quota === undefined || usage === undefined) {
    return { sufficient: true, quotaBytes: null, usageBytes: null, availableBytes: null };
  }

  const availableBytes = quota - usage;
  return {
    sufficient: availableBytes >= estimatedBytes,
    quotaBytes: quota,
    usageBytes: usage,
    availableBytes,
  };
}
