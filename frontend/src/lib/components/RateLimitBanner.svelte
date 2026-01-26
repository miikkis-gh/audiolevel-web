<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { RateLimitStatus } from '../../stores/api';

  interface Props {
    status: RateLimitStatus | null;
    error?: string | null;
    onRefresh?: () => void;
  }

  let { status, error = null, onRefresh }: Props = $props();

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

  function formatTimeRemaining(resetAt: number): string {
    const remaining = Math.max(0, resetAt - now);
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    if (remaining <= 0) return 'now';
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  let isLimitReached = $derived(status?.remaining === 0);
  let isWarning = $derived(status && status.remaining <= 3 && status.remaining > 0);
</script>

{#if error}
  <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
    <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <span>{error}</span>
    {#if onRefresh}
      <button
        onclick={onRefresh}
        class="ml-auto text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 underline"
      >
        Retry
      </button>
    {/if}
  </div>
{:else if isLimitReached && status}
  <div class="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center flex-shrink-0">
        <svg class="w-5 h-5 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div class="flex-1">
        <h3 class="font-medium text-orange-800 dark:text-orange-200">Upload limit reached</h3>
        <p class="text-sm text-orange-700 dark:text-orange-300 mt-1">
          You've used all {status.limit} uploads for this hour.
          You can upload again in <span class="font-medium">{formatTimeRemaining(status.resetAt)}</span>.
        </p>
        <div class="mt-3 flex items-center gap-4">
          <div class="flex-1 bg-orange-200 dark:bg-orange-900/50 rounded-full h-2">
            <div class="bg-orange-500 h-2 rounded-full" style="width: 100%"></div>
          </div>
          <span class="text-xs text-orange-600 dark:text-orange-400 font-medium">{status.used}/{status.limit}</span>
        </div>
      </div>
    </div>
  </div>
{:else if isWarning && status}
  <div class="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
    <div class="flex items-center gap-2 text-sm text-yellow-700 dark:text-yellow-300">
      <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span>
        <span class="font-medium">{status.remaining}</span> upload{status.remaining !== 1 ? 's' : ''} remaining this hour
      </span>
      <div class="ml-auto flex items-center gap-2">
        <div class="w-20 bg-yellow-200 dark:bg-yellow-900/50 rounded-full h-1.5">
          <div
            class="bg-yellow-500 h-1.5 rounded-full"
            style="width: {(status.used / status.limit) * 100}%"
          ></div>
        </div>
        <span class="text-xs text-yellow-600 dark:text-yellow-400">{status.used}/{status.limit}</span>
      </div>
    </div>
  </div>
{:else if status}
  <div class="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <span>{status.remaining} of {status.limit} uploads remaining</span>
  </div>
{/if}
