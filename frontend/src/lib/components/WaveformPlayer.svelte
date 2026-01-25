<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import WaveSurfer from 'wavesurfer.js';

  interface Props {
    audioUrl: string;
    label?: string;
    color?: string;
    height?: number;
  }

  let { audioUrl, label = '', color = '#6366f1', height = 80 }: Props = $props();

  let container: HTMLDivElement;
  let wavesurfer: WaveSurfer | null = null;
  let isPlaying = $state(false);
  let isLoading = $state(true);
  let currentTime = $state(0);
  let duration = $state(0);
  let error = $state<string | null>(null);

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  onMount(() => {
    if (!container) return;

    wavesurfer = WaveSurfer.create({
      container,
      waveColor: '#d1d5db',
      progressColor: color,
      cursorColor: color,
      height,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      hideScrollbar: true,
    });

    wavesurfer.on('ready', () => {
      isLoading = false;
      duration = wavesurfer?.getDuration() || 0;
    });

    wavesurfer.on('play', () => {
      isPlaying = true;
    });

    wavesurfer.on('pause', () => {
      isPlaying = false;
    });

    wavesurfer.on('timeupdate', (time) => {
      currentTime = time;
    });

    wavesurfer.on('error', (err) => {
      isLoading = false;
      error = 'Failed to load audio';
      console.error('Wavesurfer error:', err);
    });

    wavesurfer.load(audioUrl);
  });

  onDestroy(() => {
    if (wavesurfer) {
      wavesurfer.destroy();
      wavesurfer = null;
    }
  });

  function togglePlay() {
    if (wavesurfer) {
      wavesurfer.playPause();
    }
  }

  function stop() {
    if (wavesurfer) {
      wavesurfer.stop();
    }
  }
</script>

<div class="rounded-lg border border-gray-200 bg-white overflow-hidden">
  {#if label}
    <div class="px-3 py-2 bg-gray-50 border-b border-gray-200">
      <span class="text-sm font-medium text-gray-700">{label}</span>
    </div>
  {/if}

  <div class="p-3">
    {#if error}
      <div class="h-20 flex items-center justify-center text-red-500 text-sm">
        {error}
      </div>
    {:else}
      <div class="relative">
        {#if isLoading}
          <div class="absolute inset-0 flex items-center justify-center bg-gray-50">
            <svg class="animate-spin h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        {/if}
        <div bind:this={container} class="w-full"></div>
      </div>

      <!-- Controls -->
      <div class="flex items-center justify-between mt-3">
        <div class="flex items-center gap-2">
          <button
            onclick={togglePlay}
            class="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
            disabled={isLoading}
          >
            {#if isPlaying}
              <svg class="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            {:else}
              <svg class="w-5 h-5 text-gray-700 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            {/if}
          </button>
          <button
            onclick={stop}
            class="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
            disabled={isLoading}
          >
            <svg class="w-4 h-4 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>
        </div>
        <div class="text-sm text-gray-500 font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>
    {/if}
  </div>
</div>
