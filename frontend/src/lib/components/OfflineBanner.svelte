<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let isOnline = $state(true);
  let showBanner = $state(false);
  let wasOffline = $state(false);

  function handleOnline() {
    isOnline = true;
    if (wasOffline) {
      // Show "back online" message briefly
      setTimeout(() => {
        showBanner = false;
        wasOffline = false;
      }, 3000);
    }
  }

  function handleOffline() {
    isOnline = false;
    wasOffline = true;
    showBanner = true;
  }

  onMount(() => {
    isOnline = navigator.onLine;
    showBanner = !isOnline;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  });

  onDestroy(() => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  });
</script>

{#if showBanner}
  <div
    class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl glass-card flex items-center gap-3 text-sm font-medium animate-slide-up
      {isOnline
        ? 'bg-gradient-to-r from-emerald-500/30 to-green-500/30 border-emerald-500/30'
        : 'bg-gradient-to-r from-white/10 to-white/5'}"
    role="status"
    aria-live="polite"
  >
    {#if isOnline}
      <div class="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
        <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <span class="text-emerald-200">Back online</span>
    {:else}
      <div class="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
        <svg class="w-4 h-4 text-white/60 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656m-7.072 7.072a9 9 0 010-12.728m3.536 3.536a4 4 0 010 5.656" />
        </svg>
      </div>
      <span class="text-white/70">You're offline. Some features may not work.</span>
    {/if}
  </div>
{/if}
