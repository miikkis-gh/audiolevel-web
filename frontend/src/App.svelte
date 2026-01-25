<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import FileUpload from './lib/components/FileUpload.svelte';
  import ProgressIndicator from './lib/components/ProgressIndicator.svelte';
  import ConnectionStatus from './lib/components/ConnectionStatus.svelte';
  import {
    connectWebSocket,
    disconnectWebSocket,
    subscribeToJob,
    clearJobData,
  } from './stores/websocket';
  import { fetchPresets, uploadFile, type Preset } from './stores/api';

  // State
  let presets = $state<Preset[]>([]);
  let selectedPreset = $state('podcast');
  let isUploading = $state(false);
  let uploadError = $state<string | null>(null);
  let activeJobs = $state<Array<{ id: string; fileName: string }>>([]);

  // Load presets on mount
  onMount(async () => {
    // Connect WebSocket
    connectWebSocket();

    // Fetch presets
    try {
      presets = await fetchPresets();
      if (presets.length > 0) {
        selectedPreset = presets[0].id;
      }
    } catch (err) {
      console.error('Failed to fetch presets:', err);
    }
  });

  onDestroy(() => {
    disconnectWebSocket();
  });

  async function handleFileSelect(file: File) {
    if (isUploading) return;

    isUploading = true;
    uploadError = null;

    try {
      const result = await uploadFile(file, selectedPreset);

      // Add to active jobs and subscribe to WebSocket updates
      activeJobs = [...activeJobs, { id: result.jobId, fileName: file.name }];
      subscribeToJob(result.jobId);
    } catch (err) {
      uploadError = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      isUploading = false;
    }
  }

  function handlePresetChange(preset: string) {
    selectedPreset = preset;
  }

  function handleDownload(url: string) {
    // Open download in new tab/trigger download
    const link = document.createElement('a');
    link.href = `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}${url}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleClearJob(jobId: string) {
    clearJobData(jobId);
    activeJobs = activeJobs.filter((job) => job.id !== jobId);
  }

  async function handleRetry(jobId: string, fileName: string) {
    // Clear the failed job
    handleClearJob(jobId);

    // Note: In a real implementation, you'd need to re-upload the file
    // For now, we just show an error message
    uploadError = 'Please re-upload the file to retry.';
  }
</script>

<main class="min-h-screen bg-gray-50 py-8 px-4">
  <div class="max-w-2xl mx-auto">
    <!-- Header -->
    <div class="text-center mb-8">
      <h1 class="text-4xl font-bold text-gray-900 mb-2">AudioLevel</h1>
      <p class="text-gray-600">
        Free audio normalization with industry-standard presets
      </p>
    </div>

    <!-- Main card -->
    <div class="bg-white rounded-lg shadow-lg p-6 md:p-8 mb-6">
      <!-- File upload -->
      <FileUpload
        onFileSelect={handleFileSelect}
        {selectedPreset}
        {presets}
        onPresetChange={handlePresetChange}
        disabled={isUploading}
      />

      <!-- Upload error -->
      {#if uploadError}
        <div class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p class="text-sm text-red-600">{uploadError}</p>
        </div>
      {/if}

      <!-- Uploading indicator -->
      {#if isUploading}
        <div class="mt-4 flex items-center justify-center gap-2 text-gray-500">
          <svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Uploading...</span>
        </div>
      {/if}
    </div>

    <!-- Active jobs -->
    {#if activeJobs.length > 0}
      <div class="space-y-4 mb-6">
        <h2 class="text-lg font-semibold text-gray-900">Processing</h2>
        {#each activeJobs as job (job.id)}
          <ProgressIndicator
            jobId={job.id}
            fileName={job.fileName}
            onDownload={handleDownload}
            onRetry={() => handleRetry(job.id, job.fileName)}
            onCancel={() => handleClearJob(job.id)}
          />
        {/each}
      </div>
    {/if}

    <!-- Footer -->
    <div class="flex items-center justify-between text-xs text-gray-400">
      <p>Files are automatically deleted after 15 minutes. No account required.</p>
      <ConnectionStatus />
    </div>
  </div>
</main>
