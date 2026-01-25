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
    <div class="text-center py-8 text-gray-500">
      <svg class="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
      <p class="text-sm">No recent downloads</p>
      <p class="text-xs text-gray-400 mt-1">Processed files will appear here</p>
    </div>
  {:else}
    {#each activeItems as item (item.id)}
      <div
        class="bg-white rounded-lg border border-gray-200 p-4 transition-all hover:shadow-sm
          {isExpiringSoon(item.expiresAt) ? 'border-orange-200 bg-orange-50' : ''}"
      >
        <div class="flex items-start gap-3">
          <!-- Icon -->
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
              {isExpiringSoon(item.expiresAt) ? 'bg-orange-100' : 'bg-gray-100'}"
          >
            <svg
              class="w-5 h-5 {isExpiringSoon(item.expiresAt) ? 'text-orange-500' : 'text-gray-500'}"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="font-medium text-gray-900 truncate text-sm" title={item.fileName}>
                {item.fileName}
              </p>
              <span class="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded uppercase">
                {item.outputFormat}
              </span>
            </div>

            <div class="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
              <span>{item.preset}</span>
              {#if item.fileSize}
                <span>{formatFileSize(item.fileSize)}</span>
              {/if}
              {#if item.duration}
                <span>{formatDuration(item.duration)}</span>
              {/if}
              {#if item.outputLufs}
                <span>{item.outputLufs.toFixed(1)} LUFS</span>
              {/if}
            </div>

            <!-- Expiration Timer -->
            <div class="flex items-center gap-1 mt-2">
              <svg
                class="w-3.5 h-3.5 {isExpiringSoon(item.expiresAt) ? 'text-orange-500' : 'text-gray-400'}"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span
                class="text-xs {isExpiringSoon(item.expiresAt) ? 'text-orange-600 font-medium' : 'text-gray-400'}"
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
                class="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                title="View details"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            {/if}
            <button
              onclick={() => onDownload(item.downloadUrl, item.fileName)}
              class="p-2 text-primary-500 hover:text-primary-600 transition-colors"
              title="Download"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <button
              onclick={() => onRemove(item.id)}
              class="p-2 text-gray-400 hover:text-red-500 transition-colors"
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
