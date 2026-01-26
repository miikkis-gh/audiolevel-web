<script lang="ts">
  import type { ApiError } from '../../stores/api';

  interface Props {
    error: string | ApiError | null;
    onRetry?: () => void;
    onDismiss?: () => void;
  }

  let { error, onRetry, onDismiss }: Props = $props();

  let errorMessage = $derived(typeof error === 'string' ? error : error?.message || '');
  let errorHint = $derived(typeof error === 'object' && error?.hint ? error.hint : null);
  let errorCode = $derived(typeof error === 'object' && error?.code ? error.code : null);

  function getIconForError(code: string | null): 'warning' | 'error' | 'info' {
    if (!code) return 'error';

    if (code.includes('RATE') || code.includes('QUEUE')) return 'warning';
    if (code.includes('NOT_FOUND') || code.includes('EXPIRED')) return 'info';
    return 'error';
  }

  let iconType = $derived(getIconForError(errorCode));
</script>

{#if error}
  <div
    class="rounded-lg p-4 {iconType === 'warning' ? 'bg-amber-50 border border-amber-200' : iconType === 'info' ? 'bg-blue-50 border border-blue-200' : 'bg-red-50 border border-red-200'}"
    role="alert"
  >
    <div class="flex items-start gap-3">
      <!-- Icon -->
      <div class="flex-shrink-0 mt-0.5">
        {#if iconType === 'warning'}
          <svg class="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        {:else if iconType === 'info'}
          <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        {:else}
          <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        {/if}
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium {iconType === 'warning' ? 'text-amber-800' : iconType === 'info' ? 'text-blue-800' : 'text-red-800'}">
          {errorMessage}
        </p>
        {#if errorHint}
          <p class="mt-1 text-sm {iconType === 'warning' ? 'text-amber-700' : iconType === 'info' ? 'text-blue-700' : 'text-red-700'}">
            {errorHint}
          </p>
        {/if}

        <!-- Actions -->
        {#if onRetry || onDismiss}
          <div class="mt-3 flex gap-3">
            {#if onRetry}
              <button
                onclick={onRetry}
                class="text-sm font-medium {iconType === 'warning' ? 'text-amber-600 hover:text-amber-800' : iconType === 'info' ? 'text-blue-600 hover:text-blue-800' : 'text-red-600 hover:text-red-800'} underline-offset-2 hover:underline"
              >
                Try again
              </button>
            {/if}
            {#if onDismiss}
              <button
                onclick={onDismiss}
                class="text-sm font-medium text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
              >
                Dismiss
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Dismiss button -->
      {#if onDismiss}
        <button
          onclick={onDismiss}
          class="flex-shrink-0 p-1 rounded-md {iconType === 'warning' ? 'text-amber-400 hover:text-amber-600 hover:bg-amber-100' : iconType === 'info' ? 'text-blue-400 hover:text-blue-600 hover:bg-blue-100' : 'text-red-400 hover:text-red-600 hover:bg-red-100'}"
          aria-label="Dismiss"
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
          </svg>
        </button>
      {/if}
    </div>
  </div>
{/if}
