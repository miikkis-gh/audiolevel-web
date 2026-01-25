<script lang="ts">
  import type { Preset } from '../../stores/api';

  interface Props {
    onFileSelect: (file: File, outputFormat: string) => void;
    selectedPreset: string;
    presets: Preset[];
    onPresetChange: (preset: string) => void;
    disabled?: boolean;
  }

  let { onFileSelect, selectedPreset, presets, onPresetChange, disabled = false }: Props = $props();

  // Constants
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  const ALLOWED_TYPES = [
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/mp3',
    'audio/mpeg',
    'audio/flac',
    'audio/x-flac',
    'audio/aac',
    'audio/ogg',
    'audio/vorbis',
  ];
  const OUTPUT_FORMATS = [
    { id: 'wav', name: 'WAV', description: 'Lossless, large file size' },
    { id: 'mp3', name: 'MP3', description: '320kbps, widely compatible' },
    { id: 'flac', name: 'FLAC', description: 'Lossless compression' },
    { id: 'aac', name: 'AAC', description: '256kbps, modern format' },
    { id: 'ogg', name: 'OGG', description: 'Open format, good quality' },
  ];

  let dragOver = $state(false);
  let fileInput: HTMLInputElement;
  let selectedFile = $state<File | null>(null);
  let validationError = $state<string | null>(null);
  let outputFormat = $state('wav');

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileExtension(filename: string): string {
    return filename.split('.').pop()?.toUpperCase() || 'Unknown';
  }

  function validateFile(file: File): string | null {
    if (file.size > MAX_FILE_SIZE) {
      return `File too large (${formatFileSize(file.size)}). Maximum size is 100MB.`;
    }

    // Check MIME type
    const isValidType = ALLOWED_TYPES.some((type) => file.type.includes(type.split('/')[1]));

    // Also check extension as fallback
    const ext = file.name.split('.').pop()?.toLowerCase();
    const validExtensions = ['wav', 'mp3', 'flac', 'aac', 'ogg', 'm4a'];
    const hasValidExtension = ext ? validExtensions.includes(ext) : false;

    if (!isValidType && !hasValidExtension) {
      return `Unsupported file type. Please upload WAV, MP3, FLAC, AAC, or OGG files.`;
    }

    return null;
  }

  function handleFileSelection(file: File) {
    const error = validateFile(file);
    if (error) {
      validationError = error;
      selectedFile = null;
      return;
    }

    validationError = null;
    selectedFile = file;

    // Auto-detect output format from input
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext && OUTPUT_FORMATS.some((f) => f.id === ext)) {
      outputFormat = ext;
    }
  }

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
      handleFileSelection(files[0]);
    }
  }

  function handleFileInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      handleFileSelection(target.files[0]);
    }
  }

  function handleClick() {
    if (!disabled) {
      fileInput.click();
    }
  }

  function handleSubmit() {
    if (selectedFile && !disabled) {
      onFileSelect(selectedFile, outputFormat);
      selectedFile = null;
    }
  }

  function clearFile() {
    selectedFile = null;
    validationError = null;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  // Get selected preset details
  let selectedPresetDetails = $derived(presets.find((p) => p.id === selectedPreset));
</script>

<div class="space-y-6">
  <!-- Drop Zone -->
  {#if !selectedFile}
    <div
      class="border-2 border-dashed rounded-lg p-8 md:p-12 text-center transition-all cursor-pointer
        {dragOver ? 'border-primary-500 bg-primary-50 scale-[1.02]' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'}
        {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
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
        accept="audio/*,.wav,.mp3,.flac,.aac,.ogg,.m4a"
        class="hidden"
        onchange={handleFileInput}
        {disabled}
      />

      <div class="flex flex-col items-center">
        <div class="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <p class="text-gray-700 font-medium mb-1">Drop your audio file here</p>
        <p class="text-gray-500 text-sm mb-3">or click to browse</p>
        <div class="flex flex-wrap justify-center gap-2">
          {#each ['WAV', 'MP3', 'FLAC', 'AAC', 'OGG'] as format}
            <span class="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">{format}</span>
          {/each}
        </div>
        <p class="text-gray-400 text-xs mt-3">Maximum file size: 100MB</p>
      </div>
    </div>
  {:else}
    <!-- Selected File Display -->
    <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div class="flex items-start gap-4">
        <div class="w-12 h-12 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
          <svg class="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-medium text-gray-900 truncate" title={selectedFile.name}>{selectedFile.name}</p>
          <div class="flex flex-wrap gap-3 mt-1 text-sm text-gray-500">
            <span class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {getFileExtension(selectedFile.name)}
            </span>
            <span class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              {formatFileSize(selectedFile.size)}
            </span>
          </div>
        </div>
        <button
          onclick={clearFile}
          class="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          title="Remove file"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  {/if}

  <!-- Validation Error -->
  {#if validationError}
    <div class="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
      <svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm text-red-700">{validationError}</p>
    </div>
  {/if}

  <!-- Preset Selection -->
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-3">Normalization Preset</label>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      {#each presets as preset}
        <button
          type="button"
          onclick={() => onPresetChange(preset.id)}
          class="relative p-3 rounded-lg border-2 text-left transition-all
            {selectedPreset === preset.id
              ? 'border-primary-500 bg-primary-50'
              : 'border-gray-200 hover:border-gray-300 bg-white'}
            {disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
          {disabled}
        >
          {#if selectedPreset === preset.id}
            <div class="absolute top-2 right-2">
              <svg class="w-4 h-4 text-primary-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
          {/if}
          <p class="font-medium text-gray-900 text-sm">{preset.name}</p>
          <p class="text-xs text-gray-500 mt-0.5">{preset.targetLufs} LUFS</p>
        </button>
      {/each}
    </div>
    {#if selectedPresetDetails}
      <p class="text-sm text-gray-500 mt-2">
        {selectedPresetDetails.description}
        <span class="text-gray-400">
          (True Peak: {selectedPresetDetails.truePeak} dB)
        </span>
      </p>
    {/if}
  </div>

  <!-- Output Format Selection -->
  <div>
    <label class="block text-sm font-medium text-gray-700 mb-3">Output Format</label>
    <div class="flex flex-wrap gap-2">
      {#each OUTPUT_FORMATS as format}
        <button
          type="button"
          onclick={() => (outputFormat = format.id)}
          class="px-4 py-2 rounded-lg border-2 text-sm transition-all
            {outputFormat === format.id
              ? 'border-primary-500 bg-primary-50 text-primary-700'
              : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'}
            {disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
          {disabled}
        >
          {format.name}
        </button>
      {/each}
    </div>
    <p class="text-xs text-gray-400 mt-2">
      {OUTPUT_FORMATS.find((f) => f.id === outputFormat)?.description}
    </p>
  </div>

  <!-- Submit Button -->
  {#if selectedFile}
    <button
      type="button"
      onclick={handleSubmit}
      class="w-full py-3 px-4 bg-primary-500 text-white font-medium rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      {disabled}
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      Normalize Audio
    </button>
  {/if}
</div>
