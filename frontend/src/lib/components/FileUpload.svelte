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
    { id: 'wav', name: 'WAV', description: 'Lossless, large file size', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { id: 'mp3', name: 'MP3', description: '320kbps, widely compatible', icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' },
    { id: 'flac', name: 'FLAC', description: 'Lossless compression', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    { id: 'aac', name: 'AAC', description: '256kbps, modern format', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    { id: 'ogg', name: 'OGG', description: 'Open format, good quality', icon: 'M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2M7 4h10M7 4v16M17 4v16M7 20h10M5 8h14M5 12h14M5 16h14' },
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

<div class="space-y-8">
  <!-- Drop Zone -->
  {#if !selectedFile}
    <div
      class="relative group rounded-2xl p-8 md:p-12 text-center transition-all duration-300 cursor-pointer border border-dashed
        {dragOver
          ? 'border-indigo-400/60 bg-indigo-500/10 scale-[1.02]'
          : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'}
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
        <!-- Upload icon with glow -->
        <div class="relative mb-6">
          <div class="absolute inset-0 bg-indigo-500/20 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div class="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-white/10 flex items-center justify-center">
            <svg class="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
        </div>

        <p class="text-white/90 font-medium text-lg mb-2">Drop your audio file here</p>
        <p class="text-white/40 text-sm mb-5">or click to browse</p>

        <!-- Format badges -->
        <div class="flex flex-wrap justify-center gap-2 mb-4">
          {#each ['WAV', 'MP3', 'FLAC', 'AAC', 'OGG'] as format, i}
            <span
              class="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-white/50 text-xs font-medium animate-entrance"
              style="animation-delay: {i * 0.05}s"
            >
              {format}
            </span>
          {/each}
        </div>

        <p class="text-white/30 text-xs">Maximum file size: 100MB</p>
      </div>
    </div>
  {:else}
    <!-- Selected File Display -->
    <div class="glass-card glass-card-hover rounded-2xl p-5 animate-scale-in">
      <div class="flex items-start gap-4">
        <!-- Audio icon -->
        <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-500/30 border border-white/10 flex items-center justify-center flex-shrink-0">
          <svg class="w-7 h-7 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>

        <div class="flex-1 min-w-0">
          <p class="font-medium text-white/90 truncate text-lg" title={selectedFile.name}>{selectedFile.name}</p>
          <div class="flex flex-wrap gap-4 mt-2 text-sm text-white/50">
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {getFileExtension(selectedFile.name)}
            </span>
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
              {formatFileSize(selectedFile.size)}
            </span>
          </div>
        </div>

        <button
          onclick={clearFile}
          class="p-2 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all duration-200"
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
    <div class="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 animate-slide-up">
      <svg class="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm text-red-300">{validationError}</p>
    </div>
  {/if}

  <!-- Preset Selection -->
  <div class="space-y-4">
    <span class="block text-sm font-medium text-white/70">Normalization Preset</span>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
      {#each presets as preset, i}
        <button
          type="button"
          onclick={() => onPresetChange(preset.id)}
          class="glass-button relative p-4 rounded-xl text-left group animate-entrance
            {selectedPreset === preset.id
              ? 'bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border-indigo-500/30'
              : 'hover:bg-white/[0.03]'}
            {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
          style="animation-delay: {i * 0.05}s"
          {disabled}
        >
          <!-- Checkmark indicator -->
          {#if selectedPreset === preset.id}
            <div class="absolute top-3 right-3">
              <div class="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                </svg>
              </div>
            </div>
          {/if}

          <p class="font-medium text-white/90 text-sm mb-1">{preset.name}</p>
          <p class="text-xs text-white/40">{preset.targetLufs} LUFS</p>
        </button>
      {/each}
    </div>

    {#if selectedPresetDetails}
      <p class="text-sm text-white/50 animate-fade-in">
        {selectedPresetDetails.description}
        <span class="text-white/30 ml-1">
          (True Peak: {selectedPresetDetails.truePeak} dB)
        </span>
      </p>
    {/if}
  </div>

  <!-- Output Format Selection -->
  <div class="space-y-4">
    <span class="block text-sm font-medium text-white/70">Output Format</span>
    <div class="flex flex-wrap gap-2">
      {#each OUTPUT_FORMATS as format, i}
        <button
          type="button"
          onclick={() => (outputFormat = format.id)}
          class="glass-button px-5 py-2.5 rounded-xl text-sm group animate-entrance
            {outputFormat === format.id
              ? 'bg-gradient-to-r from-cyan-500/20 to-sky-500/20 border-cyan-500/30 text-cyan-300'
              : 'text-white/60 hover:text-white/90 hover:bg-white/[0.03]'}
            {disabled ? 'opacity-50 cursor-not-allowed' : ''}"
          style="animation-delay: {i * 0.05}s"
          {disabled}
        >
          <span class="relative z-10">{format.name}</span>
        </button>
      {/each}
    </div>
    <p class="text-xs text-white/40 animate-fade-in">
      {OUTPUT_FORMATS.find((f) => f.id === outputFormat)?.description}
    </p>
  </div>

  <!-- Submit Button -->
  {#if selectedFile}
    <button
      type="button"
      onclick={handleSubmit}
      class="glass-button glass-button-primary w-full py-4 px-6 rounded-xl font-medium text-base justify-center group animate-scale-in"
      disabled={disabled}
    >
      <!-- Icon with scale effect on hover -->
      <svg class="w-5 h-5 text-indigo-300 icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>

      <span class="text-white/90">Normalize Audio</span>

      <!-- Arrow reveal on hover with bounce -->
      <svg class="w-4 h-4 arrow text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
      </svg>
    </button>
  {/if}
</div>
