<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    text: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
    children: Snippet;
  }

  let { text, position = 'top', children }: Props = $props();
  let isVisible = $state(false);
  let timeout: ReturnType<typeof setTimeout>;

  function show() {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      isVisible = true;
    }, 200);
  }

  function hide() {
    clearTimeout(timeout);
    isVisible = false;
  }
</script>

<div
  class="relative inline-block"
  onmouseenter={show}
  onmouseleave={hide}
  onfocus={show}
  onblur={hide}
  role="tooltip"
>
  {@render children()}

  {#if isVisible}
    <div
      class="absolute z-50 px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded shadow-lg whitespace-nowrap pointer-events-none {
        position === 'top' ? 'bottom-full left-1/2 -translate-x-1/2 mb-2' :
        position === 'bottom' ? 'top-full left-1/2 -translate-x-1/2 mt-2' :
        position === 'left' ? 'right-full top-1/2 -translate-y-1/2 mr-2' :
        'left-full top-1/2 -translate-y-1/2 ml-2'
      }"
    >
      {text}
      <!-- Arrow -->
      <div
        class="absolute w-2 h-2 bg-gray-900 rotate-45 {
          position === 'top' ? 'top-full left-1/2 -translate-x-1/2 -translate-y-1/2' :
          position === 'bottom' ? 'bottom-full left-1/2 -translate-x-1/2 translate-y-1/2' :
          position === 'left' ? 'left-full top-1/2 -translate-y-1/2 -translate-x-1/2' :
          'right-full top-1/2 -translate-y-1/2 translate-x-1/2'
        }"
      ></div>
    </div>
  {/if}
</div>
