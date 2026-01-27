<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export interface HistoryItem {
    id: string;
    fileName: string;
    preset: string;
    outputFormat: string;
    downloadUrl: string;
    createdAt: number; // timestamp
    expiresAt: number; // timestamp
    fileSize?: number;
    duration?: number;
    inputLufs?: number;
    outputLufs?: number;
  }

  interface Props {
    items: HistoryItem[];
    onDownload: (url: string, fileName: string) => void;
    onRemove: (id: string) => void;
    onViewDetails?: (item: HistoryItem) => void;
  }

  let { items, onDownload, onRemove, onViewDetails }: Props = $props();

  let now = $state(Date.now());
  let intervalId: ReturnType<typeof setInterval>;

  onMount(() => {
    intervalId = setInterval(() => {
      now = Date.now();
    }, 1000);
  });

  onDestroy(() => {
    if (intervalId) {
      clearInterval(intervalId);
    }
  });

  function formatTimeRemaining(expiresAt: number): string {
    const remaining = Math.max(0, expiresAt - now);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    if (remaining <= 0) return 'Expired';
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function isExpired(expiresAt: number): boolean {
    return expiresAt <= now;
  }

  function isExpiringSoon(expiresAt: number): boolean {
    return expiresAt - now < 120000; // Less than 2 minutes
  }

  function formatFileSize(bytes: number | undefined): string {
    if (!bytes) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDuration(seconds: number | undefined): string {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Filter out expired items
  let activeItems = $derived(items.filter((item) => !isExpired(item.expiresAt)));
</script>

<div class="space-y-3">
  {#if activeItems.length === 0}
    <div class="glass-card rounded-xl p-8 text-center">
      <div class="w-14 h-14 mx-auto mb-4 rounded-xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/5 flex items-center justify-center">
        <svg class="w-7 h-7 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      </div>
      <p class="text-white/50 text-sm mb-1">No recent downloads</p>
      <p class="text-white/30 text-xs">Processed files will appear here</p>
    </div>
  {:else}
    {#each activeItems as item, i (item.id)}
      <div
        class="glass-card glass-card-hover rounded-xl p-4 animate-entrance
          {isExpiringSoon(item.expiresAt) ? 'border-amber-500/20' : ''}"
        style="animation-delay: {i * 0.05}s"
      >
        <div class="flex items-start gap-4">
          <!-- Icon -->
          <div
            class="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 border border-white/5
              {isExpiringSoon(item.expiresAt)
                ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20'
                : 'bg-gradient-to-br from-cyan-500/20 to-sky-500/20'}"
          >
            <svg
              class="w-6 h-6 {isExpiringSoon(item.expiresAt) ? 'text-amber-400' : 'text-cyan-400'}"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <p class="font-medium text-white/90 truncate text-sm" title={item.fileName}>
                {item.fileName}
              </p>
              <span class="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-white/50 text-xs font-medium uppercase">
                {item.outputFormat}
              </span>
            </div>

            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/40">
              <span class="flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                {item.preset}
              </span>
              {#if item.fileSize}
                <span class="flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  {formatFileSize(item.fileSize)}
                </span>
              {/if}
              {#if item.duration}
                <span class="flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formatDuration(item.duration)}
                </span>
              {/if}
              {#if item.outputLufs}
                <span class="flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                  {item.outputLufs.toFixed(1)} LUFS
                </span>
              {/if}
            </div>

            <!-- Expiration Timer -->
            <div class="flex items-center gap-1.5 mt-2">
              <svg
                class="w-3.5 h-3.5 {isExpiringSoon(item.expiresAt) ? 'text-amber-400' : 'text-white/30'}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span
                class="text-xs {isExpiringSoon(item.expiresAt) ? 'text-amber-400 font-medium' : 'text-white/30'}"
              >
                Expires in {formatTimeRemaining(item.expiresAt)}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-1">
            {#if onViewDetails}
              <button
                onclick={() => onViewDetails(item)}
                class="p-2 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all duration-200"
                title="View details"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            {/if}
            <button
              onclick={() => onDownload(item.downloadUrl, item.fileName)}
              class="p-2 rounded-lg text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-all duration-200"
              title="Download"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <button
              onclick={() => onRemove(item.id)}
              class="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
              title="Remove"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>
