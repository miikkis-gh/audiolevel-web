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

/**
 * Download batch files as a single ZIP archive
 */
export async function downloadBatchAsZip(files: BatchFile[]): Promise<void> {
  const zip = new JSZip();
  const completedFiles = files.filter((f) => f.jobId && f.fileState === 'complete');

  await Promise.all(
    completedFiles.map(async (file) => {
      const url = file.downloadUrl || getDownloadUrl(file.jobId!);
      const response = await fetch(url);
      if (response.ok) {
        const blob = await response.blob();
        zip.file(file.name, blob);
      }
    })
  );

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipUrl = URL.createObjectURL(zipBlob);
  triggerDownload(zipUrl, 'audiolevel-processed.zip');
  URL.revokeObjectURL(zipUrl);
}
