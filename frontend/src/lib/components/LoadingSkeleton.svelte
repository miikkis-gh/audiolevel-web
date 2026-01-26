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
  <div class="space-y-2" style="width: {width}">
    {#each Array(lines) as _, i}
      <div
        class="bg-gray-200 rounded animate-pulse"
        style="height: {getHeight()}; width: {i === lines - 1 ? '75%' : '100%'}"
      ></div>
    {/each}
  </div>
{:else if variant === 'card'}
  <div
    class="bg-gray-200 rounded-lg animate-pulse"
    style="width: {width}; height: {getHeight()}"
  ></div>
{:else if variant === 'circle'}
  <div
    class="bg-gray-200 rounded-full animate-pulse"
    style="width: {getHeight()}; height: {getHeight()}"
  ></div>
{:else if variant === 'waveform'}
  <div
    class="bg-gray-100 rounded-lg overflow-hidden"
    style="width: {width}; height: {getHeight()}"
  >
    <div class="flex items-center justify-center h-full gap-0.5 px-2">
      {#each Array(40) as _, i}
        <div
          class="bg-gray-300 rounded-full animate-pulse"
          style="width: 3px; height: {20 + Math.sin(i * 0.5) * 30}px; animation-delay: {i * 50}ms"
        ></div>
      {/each}
    </div>
  </div>
{:else}
  <div
    class="bg-gray-200 rounded animate-pulse {variant === 'button' ? 'rounded-md' : ''}"
    style="width: {width}; height: {getHeight()}"
  ></div>
{/if}

<style>
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .animate-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
</style>
