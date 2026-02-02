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

  let statusConfig = $derived.by(() => {
    switch (status) {
      case 'queued':
        return {
          gradient: 'from-white/10 to-white/5',
          glow: '',
          textColor: 'text-white/50',
          iconColor: 'text-white/40',
        };
      case 'processing':
        return {
          gradient: 'progress-gradient',
          glow: 'glow-violet',
          textColor: 'text-violet-300',
          iconColor: 'text-violet-400',
        };
      case 'complete':
        return {
          gradient: 'from-emerald-500 to-green-500',
          glow: 'glow-success',
          textColor: 'text-emerald-300',
          iconColor: 'text-emerald-400',
        };
      case 'error':
        return {
          gradient: 'from-red-500 to-rose-500',
          glow: '',
          textColor: 'text-red-300',
          iconColor: 'text-red-400',
        };
      default:
        return {
          gradient: 'from-white/10 to-white/5',
          glow: '',
          textColor: 'text-white/50',
          iconColor: 'text-white/40',
        };
    }
  });

  function handleDownload() {
    if ($result?.downloadUrl && onDownload) {
      onDownload($result.downloadUrl);
    }
  }
</script>

<div class="glass-card glass-card-hover rounded-xl p-5">
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center gap-3 min-w-0">
      <!-- Audio icon -->
      <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/5 flex items-center justify-center flex-shrink-0">
        <svg class="w-5 h-5 {statusConfig.iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      </div>
      <span class="font-medium text-white/90 truncate" title={fileName}>{fileName}</span>
    </div>

    {#if status === 'processing' && onCancel}
      <button
        onclick={onCancel}
        class="p-2 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all duration-200"
        title="Cancel"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- Progress bar -->
  <div class="relative w-full h-2 rounded-full bg-white/5 overflow-hidden mb-3">
    <div
      class="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out bg-gradient-to-r {statusConfig.gradient}
        {status === 'processing' ? 'animate-shimmer bg-[length:200%_100%]' : ''}"
      style="width: {status === 'complete' ? 100 : status === 'error' ? 100 : $progress.percent}%"
    ></div>

    <!-- Glow effect for active progress -->
    {#if status === 'processing'}
      <div
        class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-indigo-500/50 to-violet-500/50 blur-xs"
        style="width: {$progress.percent}%"
      ></div>
    {/if}
  </div>

  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <!-- Status indicator dot -->
      {#if status === 'processing'}
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
        </span>
      {:else if status === 'complete'}
        <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      {:else if status === 'error'}
        <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      {/if}

      <span class="text-sm {statusConfig.textColor}">
        {statusText}
      </span>
    </div>

    <div class="flex gap-2">
      {#if status === 'complete' && $result?.downloadUrl}
        <button
          onclick={handleDownload}
          class="glass-button glass-button-success px-4 py-2 rounded-lg text-sm group"
        >
          <svg class="w-4 h-4 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          <span class="text-emerald-100">Download</span>
          <svg class="w-3 h-3 arrow text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      {/if}

      {#if status === 'error' && onRetry}
        <button
          onclick={onRetry}
          class="glass-button px-4 py-2 rounded-lg text-sm"
        >
          <svg class="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="text-white/80">Retry</span>
        </button>
      {/if}
    </div>
  </div>
</div>
