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
    class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all duration-300 {isOnline ? 'bg-green-500 text-white' : 'bg-gray-800 text-white'}"
    role="status"
    aria-live="polite"
  >
    {#if isOnline}
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      <span>Back online</span>
    {:else}
      <svg class="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656m-7.072 7.072a9 9 0 010-12.728m3.536 3.536a4 4 0 010 5.656" />
      </svg>
      <span>You're offline. Some features may not work.</span>
    {/if}
  </div>
{/if}
