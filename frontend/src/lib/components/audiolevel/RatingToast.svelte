<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    visible: boolean;
    onRate: (rating: 'up' | 'down') => void;
    onDismiss: () => void;
  }

  let { visible, onRate, onDismiss }: Props = $props();

  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let isExiting = $state(false);

  // Auto-dismiss after 10 seconds
  $effect(() => {
    if (visible) {
      isExiting = false;
      dismissTimer = setTimeout(() => {
        handleDismiss();
      }, 10000);
    }

    return () => {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
      }
    };
  });

  function handleRate(rating: 'up' | 'down') {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    onRate(rating);
  }

  function handleDismiss() {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    isExiting = true;
    setTimeout(() => {
      onDismiss();
    }, 300);
  }
</script>

{#if visible}
  <div class="rating-toast" class:exiting={isExiting}>
    <button class="toast-close" onclick={handleDismiss} aria-label="Dismiss">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>

    <div class="toast-prompt">How was the output quality?</div>

    <div class="toast-buttons">
      <button class="rate-btn rate-up" onclick={() => handleRate('up')} aria-label="Good quality">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
      </button>
      <button class="rate-btn rate-down" onclick={() => handleRate('down')} aria-label="Poor quality">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
        </svg>
      </button>
    </div>
  </div>
{/if}

<style>
  .rating-toast {
    position: fixed;
    bottom: 70px;
    right: 24px;
    background: rgba(16, 20, 32, 0.96);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 16px 20px;
    z-index: 150;
    animation: slideIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .rating-toast.exiting {
    animation: slideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  .toast-close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.2s ease;
    color: rgba(255, 255, 255, 0.35);
  }

  .toast-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.5);
  }

  .toast-prompt {
    font-family: 'Outfit', sans-serif;
    font-weight: 400;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 12px;
    text-align: center;
    padding-right: 20px;
  }

  .toast-buttons {
    display: flex;
    gap: 12px;
    justify-content: center;
  }

  .rate-btn {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .rate-btn:hover {
    transform: scale(1.05);
  }

  .rate-btn:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  .rate-up {
    color: rgba(80, 210, 160, 0.7);
  }

  .rate-up:hover {
    background: rgba(80, 210, 160, 0.12);
    border-color: rgba(80, 210, 160, 0.25);
    color: rgba(80, 210, 160, 1);
  }

  .rate-down {
    color: rgba(255, 120, 120, 0.7);
  }

  .rate-down:hover {
    background: rgba(255, 120, 120, 0.12);
    border-color: rgba(255, 120, 120, 0.25);
    color: rgba(255, 120, 120, 1);
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(20px) translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateX(0) translateY(0);
    }
  }

  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(0) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(20px) translateY(10px);
    }
  }
</style>
