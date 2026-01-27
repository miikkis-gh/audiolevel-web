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
  <div class="glass-card rounded-xl p-3 bg-gradient-to-br from-red-500/20 to-rose-500/20 border-red-500/20 animate-slide-up">
    <div class="flex items-center gap-3 text-sm text-red-300">
      <svg class="w-5 h-5 flex-shrink-0 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{error}</span>
      {#if onRefresh}
        <button
          onclick={onRefresh}
          class="ml-auto text-red-400 hover:text-red-300 transition-colors font-medium"
        >
          Retry
        </button>
      {/if}
    </div>
  </div>
{:else if isLimitReached && status}
  <div class="glass-card rounded-xl p-5 bg-gradient-to-br from-amber-500/20 to-orange-500/20 border-amber-500/20 animate-slide-up">
    <div class="flex items-start gap-4">
      <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-500/30 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
        <svg class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div class="flex-1">
        <h3 class="font-medium text-amber-200">Upload limit reached</h3>
        <p class="text-sm text-amber-300/70 mt-1">
          You've used all {status.limit} uploads for this hour.
          You can upload again in <span class="font-medium text-amber-200">{formatTimeRemaining(status.resetAt)}</span>.
        </p>
        <div class="mt-4 flex items-center gap-4">
          <div class="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
            <div class="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" style="width: 100%"></div>
          </div>
          <span class="text-xs text-amber-400 font-medium">{status.used}/{status.limit}</span>
        </div>
      </div>
    </div>
  </div>
{:else if isWarning && status}
  <div class="glass-card rounded-xl p-3 bg-gradient-to-br from-yellow-500/10 to-amber-500/10 border-yellow-500/20 animate-slide-up">
    <div class="flex items-center gap-3 text-sm text-yellow-200">
      <svg class="w-4 h-4 flex-shrink-0 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span>
        <span class="font-medium text-yellow-300">{status.remaining}</span> upload{status.remaining !== 1 ? 's' : ''} remaining this hour
      </span>
      <div class="ml-auto flex items-center gap-3">
        <div class="w-20 h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            class="h-full rounded-full bg-gradient-to-r from-yellow-500 to-amber-500"
            style="width: {(status.used / status.limit) * 100}%"
          ></div>
        </div>
        <span class="text-xs text-yellow-400/70">{status.used}/{status.limit}</span>
      </div>
    </div>
  </div>
{:else if status}
  <div class="flex items-center gap-2 text-sm text-white/40">
    <svg class="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <span>{status.remaining} of {status.limit} uploads remaining</span>
  </div>
{/if}
