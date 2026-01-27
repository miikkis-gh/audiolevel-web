<script lang="ts">
  interface Props {
    variant?: 'text' | 'card' | 'button' | 'circle' | 'waveform';
    width?: string;
    height?: string;
    lines?: number;
  }

  let { variant = 'text', width = '100%', height, lines = 1 }: Props = $props();

  function getHeight(): string {
    if (height) return height;
    switch (variant) {
      case 'card': return '120px';
      case 'button': return '40px';
      case 'circle': return '40px';
      case 'waveform': return '80px';
      default: return '16px';
    }
  }
</script>

{#if variant === 'text' && lines > 1}
  <div class="space-y-3" style="width: {width}">
    {#each Array(lines) as _, i}
      <div
        class="rounded-lg skeleton-shimmer"
        style="height: {getHeight()}; width: {i === lines - 1 ? '75%' : '100%'}"
      ></div>
    {/each}
  </div>
{:else if variant === 'card'}
  <div
    class="rounded-xl skeleton-shimmer"
    style="width: {width}; height: {getHeight()}"
  ></div>
{:else if variant === 'circle'}
  <div
    class="rounded-full skeleton-shimmer"
    style="width: {getHeight()}; height: {getHeight()}"
  ></div>
{:else if variant === 'waveform'}
  <div
    class="rounded-xl overflow-hidden bg-white/[0.02]"
    style="width: {width}; height: {getHeight()}"
  >
    <div class="flex items-center justify-center h-full gap-1 px-4">
      {#each Array(40) as _, i}
        <div
          class="rounded-full skeleton-wave"
          style="width: 3px; height: {20 + Math.sin(i * 0.5) * 25}px; animation-delay: {i * 50}ms"
        ></div>
      {/each}
    </div>
  </div>
{:else}
  <div
    class="rounded-lg skeleton-shimmer {variant === 'button' ? 'rounded-xl' : ''}"
    style="width: {width}; height: {getHeight()}"
  ></div>
{/if}

<style>
  @keyframes shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  @keyframes wave {
    0%, 100% {
      opacity: 0.3;
      transform: scaleY(0.8);
    }
    50% {
      opacity: 0.6;
      transform: scaleY(1);
    }
  }

  .skeleton-shimmer {
    background: linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.02) 0%,
      rgba(255, 255, 255, 0.05) 50%,
      rgba(255, 255, 255, 0.02) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 2s infinite linear;
  }

  .skeleton-wave {
    background: rgba(255, 255, 255, 0.1);
    animation: wave 1.5s ease-in-out infinite;
  }
</style>
