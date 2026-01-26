<script lang="ts">
  import { derived } from 'svelte/store';
  import { jobProgress, jobResults } from '../../stores/websocket';

  interface Props {
    jobId: string;
    fileName: string;
    onDownload?: (url: string) => void;
    onRetry?: () => void;
    onCancel?: () => void;
  }

  let { jobId, fileName, onDownload, onRetry, onCancel }: Props = $props();

  // Create derived stores that react to jobId changes
  let progress = $derived(derived(jobProgress, ($p) => $p.get(jobId) ?? { percent: 0 }));
  let result = $derived(derived(jobResults, ($r) => $r.get(jobId)));

  let status = $derived.by(() => {
    const r = $result;
    if (r?.success) return 'complete';
    if (r?.error) return 'error';
    if ($progress.percent >= 100) return 'complete';
    if ($progress.percent > 0) return 'processing';
    return 'queued';
  });

  let statusText = $derived.by(() => {
    switch (status) {
      case 'queued':
        return 'Queued...';
      case 'processing':
        return $progress.stage || `Processing... ${$progress.percent}%`;
      case 'complete':
        return 'Complete!';
      case 'error':
        return $result?.error || 'Processing failed';
      default:
        return 'Unknown';
    }
  });

  let statusColor = $derived.by(() => {
    switch (status) {
      case 'queued':
        return 'bg-gray-400';
      case 'processing':
        return 'bg-primary-500';
      case 'complete':
        return 'bg-green-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  });

  function handleDownload() {
    if ($result?.downloadUrl && onDownload) {
      onDownload($result.downloadUrl);
    }
  }
</script>

<div class="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700">
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center gap-2 min-w-0">
      <svg class="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
      <span class="font-medium text-gray-900 dark:text-gray-100 truncate" title={fileName}>{fileName}</span>
    </div>

    {#if status === 'processing' && onCancel}
      <button
        onclick={onCancel}
        class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        title="Cancel"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- Progress bar -->
  <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
    <div
      class="h-2 rounded-full transition-all duration-300 {statusColor}"
      style="width: {status === 'complete' ? 100 : status === 'error' ? 100 : $progress.percent}%"
    ></div>
  </div>

  <div class="flex items-center justify-between">
    <span class="text-sm {status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}">
      {statusText}
    </span>

    <div class="flex gap-2">
      {#if status === 'complete' && $result?.downloadUrl}
        <button
          onclick={handleDownload}
          class="inline-flex items-center gap-1 px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </button>
      {/if}

      {#if status === 'error' && onRetry}
        <button
          onclick={onRetry}
          class="inline-flex items-center gap-1 px-3 py-1 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Retry
        </button>
      {/if}
    </div>
  </div>
</div>
