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

  function getConfigForError(code: string | null) {
    if (!code) {
      return {
        type: 'error' as const,
        bgGradient: 'from-red-500/20 to-rose-500/20',
        borderColor: 'border-red-500/20',
        iconColor: 'text-red-400',
        textColor: 'text-red-200',
        hintColor: 'text-red-300/70',
        actionColor: 'text-red-400 hover:text-red-300',
      };
    }

    if (code.includes('RATE') || code.includes('QUEUE')) {
      return {
        type: 'warning' as const,
        bgGradient: 'from-amber-500/20 to-orange-500/20',
        borderColor: 'border-amber-500/20',
        iconColor: 'text-amber-400',
        textColor: 'text-amber-200',
        hintColor: 'text-amber-300/70',
        actionColor: 'text-amber-400 hover:text-amber-300',
      };
    }

    if (code.includes('NOT_FOUND') || code.includes('EXPIRED')) {
      return {
        type: 'info' as const,
        bgGradient: 'from-sky-500/20 to-cyan-500/20',
        borderColor: 'border-sky-500/20',
        iconColor: 'text-sky-400',
        textColor: 'text-sky-200',
        hintColor: 'text-sky-300/70',
        actionColor: 'text-sky-400 hover:text-sky-300',
      };
    }

    return {
      type: 'error' as const,
      bgGradient: 'from-red-500/20 to-rose-500/20',
      borderColor: 'border-red-500/20',
      iconColor: 'text-red-400',
      textColor: 'text-red-200',
      hintColor: 'text-red-300/70',
      actionColor: 'text-red-400 hover:text-red-300',
    };
  }

  let config = $derived(getConfigForError(errorCode));
</script>

{#if error}
  <div
    class="glass-card rounded-xl p-4 bg-gradient-to-br {config.bgGradient} {config.borderColor} animate-slide-up"
    role="alert"
  >
    <div class="flex items-start gap-3">
      <!-- Icon -->
      <div class="flex-shrink-0 mt-0.5">
        {#if config.type === 'warning'}
          <svg class="w-5 h-5 {config.iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        {:else if config.type === 'info'}
          <svg class="w-5 h-5 {config.iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        {:else}
          <svg class="w-5 h-5 {config.iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        {/if}
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium {config.textColor}">
          {errorMessage}
        </p>
        {#if errorHint}
          <p class="mt-1 text-sm {config.hintColor}">
            {errorHint}
          </p>
        {/if}

        <!-- Actions -->
        {#if onRetry || onDismiss}
          <div class="mt-3 flex gap-4">
            {#if onRetry}
              <button
                onclick={onRetry}
                class="text-sm font-medium {config.actionColor} transition-colors"
              >
                Try again
              </button>
            {/if}
            {#if onDismiss}
              <button
                onclick={onDismiss}
                class="text-sm font-medium text-white/40 hover:text-white/70 transition-colors"
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
          class="flex-shrink-0 p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all duration-200"
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
