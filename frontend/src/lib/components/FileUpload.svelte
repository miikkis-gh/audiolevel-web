<script lang="ts">
  import type { Preset } from '../../stores/api';

  interface Props {
    onFileSelect: (file: File) => void;
    selectedPreset: string;
    presets: Preset[];
    onPresetChange: (preset: string) => void;
    disabled?: boolean;
  }

  let { onFileSelect, selectedPreset, presets, onPresetChange, disabled = false }: Props = $props();

  let dragOver = $state(false);
  let fileInput: HTMLInputElement;

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (!disabled) {
      dragOver = true;
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (disabled) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onFileSelect(files[0]);
    }
  }

  function handleFileInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      onFileSelect(target.files[0]);
    }
  }

  function handleClick() {
    if (!disabled) {
      fileInput.click();
    }
  }
</script>

<div class="space-y-6">
  <div
    class="border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer {dragOver
      ? 'border-primary-500 bg-primary-50'
      : 'border-gray-300 hover:border-primary-400'} {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    onclick={handleClick}
    onkeydown={(e) => e.key === 'Enter' && handleClick()}
    role="button"
    tabindex="0"
  >
    <input
      bind:this={fileInput}
      type="file"
      accept="audio/*"
      class="hidden"
      onchange={handleFileInput}
      {disabled}
    />

    <svg
      class="w-12 h-12 mx-auto mb-4 text-gray-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
    <p class="text-gray-600">Drag & drop your audio file here, or click to browse</p>
    <p class="text-sm text-gray-400 mt-2">Supports WAV, MP3, FLAC, AAC, OGG (max 100MB)</p>
  </div>

  <div>
    <label for="preset" class="block text-sm font-medium text-gray-700 mb-2">
      Normalization Preset
    </label>
    <select
      id="preset"
      value={selectedPreset}
      onchange={(e) => onPresetChange((e.target as HTMLSelectElement).value)}
      class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
      {disabled}
    >
      {#each presets as preset}
        <option value={preset.id}>
          {preset.name} ({preset.targetLufs} LUFS) - {preset.description}
        </option>
      {/each}
    </select>
  </div>
</div>
