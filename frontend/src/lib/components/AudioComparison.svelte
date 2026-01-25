<script lang="ts">
  import WaveformPlayer from './WaveformPlayer.svelte';

  interface LoudnessData {
    lufs: number;
    truePeak: number;
    loudnessRange?: number;
  }

  interface Props {
    originalUrl?: string;
    processedUrl?: string;
    originalLoudness?: LoudnessData;
    processedLoudness?: LoudnessData;
    targetLufs?: number;
  }

  let {
    originalUrl,
    processedUrl,
    originalLoudness,
    processedLoudness,
    targetLufs,
  }: Props = $props();

  let activeTab = $state<'original' | 'processed'>('processed');

  function formatLufs(value: number | undefined): string {
    if (value === undefined) return '--';
    return `${value.toFixed(1)} LUFS`;
  }

  function formatDb(value: number | undefined): string {
    if (value === undefined) return '--';
    return `${value.toFixed(1)} dB`;
  }

  // Calculate how close the output is to target
  let deviation = $derived(
    processedLoudness && targetLufs !== undefined
      ? Math.abs(processedLoudness.lufs - targetLufs)
      : null
  );

  let deviationStatus = $derived.by(() => {
    if (deviation === null) return 'unknown';
    if (deviation <= 0.5) return 'excellent';
    if (deviation <= 1.0) return 'good';
    return 'fair';
  });
</script>

<div class="space-y-4">
  <!-- Loudness Comparison -->
  {#if originalLoudness || processedLoudness}
    <div class="grid grid-cols-2 gap-4">
      <!-- Original -->
      <div class="bg-gray-50 rounded-lg p-4">
        <h4 class="text-sm font-medium text-gray-500 mb-3">Original</h4>
        <div class="space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-xs text-gray-500">Loudness</span>
            <span class="text-sm font-mono font-medium text-gray-900">
              {formatLufs(originalLoudness?.lufs)}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-gray-500">True Peak</span>
            <span class="text-sm font-mono font-medium text-gray-900">
              {formatDb(originalLoudness?.truePeak)}
            </span>
          </div>
          {#if originalLoudness?.loudnessRange}
            <div class="flex justify-between items-center">
              <span class="text-xs text-gray-500">LRA</span>
              <span class="text-sm font-mono font-medium text-gray-900">
                {originalLoudness.loudnessRange.toFixed(1)} LU
              </span>
            </div>
          {/if}
        </div>
      </div>

      <!-- Processed -->
      <div class="bg-primary-50 rounded-lg p-4">
        <h4 class="text-sm font-medium text-primary-700 mb-3">Normalized</h4>
        <div class="space-y-2">
          <div class="flex justify-between items-center">
            <span class="text-xs text-primary-600">Loudness</span>
            <span class="text-sm font-mono font-medium text-primary-900">
              {formatLufs(processedLoudness?.lufs)}
            </span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-xs text-primary-600">True Peak</span>
            <span class="text-sm font-mono font-medium text-primary-900">
              {formatDb(processedLoudness?.truePeak)}
            </span>
          </div>
          {#if targetLufs !== undefined}
            <div class="flex justify-between items-center">
              <span class="text-xs text-primary-600">Target</span>
              <span class="text-sm font-mono font-medium text-primary-900">
                {targetLufs} LUFS
              </span>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Deviation indicator -->
    {#if deviation !== null}
      <div class="flex items-center gap-2 text-sm">
        <span class="text-gray-500">Accuracy:</span>
        <span
          class="px-2 py-0.5 rounded text-xs font-medium
            {deviationStatus === 'excellent'
              ? 'bg-green-100 text-green-700'
              : deviationStatus === 'good'
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-orange-100 text-orange-700'}"
        >
          {#if deviationStatus === 'excellent'}
            Excellent
          {:else if deviationStatus === 'good'}
            Good
          {:else}
            Fair
          {/if}
          ({deviation.toFixed(1)} LU from target)
        </span>
      </div>
    {/if}
  {/if}

  <!-- Waveform Comparison -->
  {#if originalUrl || processedUrl}
    <!-- Tab Buttons -->
    <div class="flex border-b border-gray-200">
      {#if processedUrl}
        <button
          onclick={() => (activeTab = 'processed')}
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors
            {activeTab === 'processed'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'}"
        >
          Normalized
        </button>
      {/if}
      {#if originalUrl}
        <button
          onclick={() => (activeTab = 'original')}
          class="px-4 py-2 text-sm font-medium border-b-2 transition-colors
            {activeTab === 'original'
              ? 'border-primary-500 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'}"
        >
          Original
        </button>
      {/if}
    </div>

    <!-- Waveform Display -->
    <div class="mt-4">
      {#if activeTab === 'original' && originalUrl}
        <WaveformPlayer audioUrl={originalUrl} color="#9ca3af" />
      {:else if activeTab === 'processed' && processedUrl}
        <WaveformPlayer audioUrl={processedUrl} color="#6366f1" />
      {/if}
    </div>
  {/if}
</div>
