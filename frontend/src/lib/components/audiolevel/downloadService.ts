import JSZip from 'jszip';
import { getDownloadUrl } from '../../../stores/api';
import type { BatchFile } from './constants';

/**
 * Trigger a file download using a temporary anchor element (avoids popup blocker)
 */
export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Download batch files individually with staggered timing to avoid popup blocker
 */
export function downloadBatchFilesStaggered(
  files: BatchFile[],
  onProgress: (remaining: number) => void,
  onComplete: () => void,
): void {
  const completedFiles = files.filter((f) => f.jobId && f.fileState === 'complete');
  let remaining = completedFiles.length;
  onProgress(remaining);

  completedFiles.forEach((file, i) => {
    setTimeout(() => {
      const url = file.downloadUrl || getDownloadUrl(file.jobId!);
      triggerDownload(url, file.name);
      remaining--;
      onProgress(remaining);
      if (remaining === 0) {
        onComplete();
      }
    }, i * 300);
  });
}

export interface ZipResult {
  addedCount: number;
  failedFiles: string[];
}

/**
 * Download batch files as a single ZIP archive.
 * Fetches files sequentially and uses Uint8Array to reduce memory pressure
 * compared to holding Blob references. Each file's memory is released after
 * being added to the ZIP.
 */
export async function downloadBatchAsZip(
  files: BatchFile[],
  onFileProgress?: (fetched: number, total: number) => void,
): Promise<ZipResult> {
  const zip = new JSZip();
  const completedFiles = files.filter((f) => f.jobId && f.fileState === 'complete');
  const failedFiles: string[] = [];
  let fetched = 0;

  // Process files in small batches to bound peak memory usage
  const BATCH_SIZE = 3;
  for (let i = 0; i < completedFiles.length; i += BATCH_SIZE) {
    const batch = completedFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const url = file.downloadUrl || getDownloadUrl(file.jobId!);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        // Use arrayBuffer → Uint8Array for more predictable GC than Blob
        const buffer = await response.arrayBuffer();
        return { name: file.name, data: new Uint8Array(buffer) };
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') {
        zip.file(result.value.name, result.value.data);
      } else {
        failedFiles.push(batch[j].name);
      }
      fetched++;
      onFileProgress?.(fetched, completedFiles.length);
    }
  }

  if (fetched - failedFiles.length === 0) {
    throw new Error('All file downloads failed');
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipUrl = URL.createObjectURL(zipBlob);
  triggerDownload(zipUrl, 'audiolevel-processed.zip');
  URL.revokeObjectURL(zipUrl);

  return { addedCount: fetched - failedFiles.length, failedFiles };
}
