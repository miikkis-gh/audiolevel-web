<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import FileUpload from './lib/components/FileUpload.svelte';
  import ProgressIndicator from './lib/components/ProgressIndicator.svelte';
  import ConnectionStatus from './lib/components/ConnectionStatus.svelte';
  import DownloadHistory from './lib/components/DownloadHistory.svelte';
  import RateLimitBanner from './lib/components/RateLimitBanner.svelte';
  import type { HistoryItem } from './lib/components/DownloadHistory.svelte';
  import {
    connectWebSocket,
    disconnectWebSocket,
    subscribeToJob,
    clearJobData,
    jobResults,
  } from './stores/websocket';
  import {
    fetchPresets,
    uploadFile,
    fetchRateLimitStatus,
    type Preset,
    type RateLimitStatus,
    type ApiError,
  } from './stores/api';
  import {
    downloadHistory,
    addToHistory,
    removeFromHistory,
    cleanupExpired,
  } from './stores/history';

  // State
  let presets = $state<Preset[]>([]);
  let selectedPreset = $state('podcast');
  let isUploading = $state(false);
  let uploadError = $state<string | null>(null);
  let activeJobs = $state<Array<{ id: string; fileName: string; preset: string; outputFormat: string }>>([]);
  let cleanupInterval: ReturnType<typeof setInterval>;
  let rateLimitStatus = $state<RateLimitStatus | null>(null);
  let rateLimitError = $state<string | null>(null);

  // API URL for downloads
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  // Function to refresh rate limit status
  async function refreshRateLimitStatus() {
    try {
      rateLimitStatus = await fetchRateLimitStatus();
      rateLimitError = null;
    } catch (err) {
      rateLimitError = 'Unable to check upload limits';
      console.error('Failed to fetch rate limit status:', err);
    }
  }

  // Load presets on mount
  onMount(async () => {
    // Connect WebSocket
    connectWebSocket();

    // Fetch presets and rate limit status in parallel
    try {
      const [presetsResult] = await Promise.all([
        fetchPresets(),
        refreshRateLimitStatus(),
      ]);
      presets = presetsResult;
      if (presets.length > 0) {
        selectedPreset = presets[0].id;
      }
    } catch (err) {
      console.error('Failed to fetch presets:', err);
    }

    // Clean up expired items periodically
    cleanupExpired();
    cleanupInterval = setInterval(cleanupExpired, 60000); // Every minute
  });

  onDestroy(() => {
    disconnectWebSocket();
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
    }
  });

  // Watch for job completions to add to history
  $effect(() => {
    const results = $jobResults;
    for (const [jobId, result] of results) {
      if (result.success && result.downloadUrl) {
        const job = activeJobs.find((j) => j.id === jobId);
        if (job) {
          // Add to download history
          addToHistory({
            id: jobId,
            fileName: job.fileName.replace(/\.[^.]+$/, `.${job.outputFormat}`),
            preset: job.preset,
            outputFormat: job.outputFormat,
            downloadUrl: result.downloadUrl,
          });
        }
      }
    }
  });

  async function handleFileSelect(file: File, outputFormat: string) {
    if (isUploading) return;

    // Check if rate limited
    if (rateLimitStatus?.remaining === 0) {
      uploadError = 'Upload limit reached. Please wait for the limit to reset.';
      return;
    }

    isUploading = true;
    uploadError = null;

    try {
      const result = await uploadFile(file, selectedPreset, outputFormat);

      // Add to active jobs and subscribe to WebSocket updates
      activeJobs = [
        ...activeJobs,
        {
          id: result.jobId,
          fileName: file.name,
          preset: selectedPreset,
          outputFormat,
        },
      ];
      subscribeToJob(result.jobId);

      // Refresh rate limit status after successful upload
      await refreshRateLimitStatus();
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.status === 429) {
        uploadError = apiError.retryAfter
          ? `Upload limit reached. Please try again in ${Math.ceil(apiError.retryAfter / 60)} minute${apiError.retryAfter > 60 ? 's' : ''}.`
          : 'Upload limit reached. Please try again later.';
        // Refresh status to update the banner
        await refreshRateLimitStatus();
      } else {
        uploadError = err instanceof Error ? err.message : 'Upload failed';
      }
    } finally {
      isUploading = false;
    }
  }

  function handlePresetChange(preset: string) {
    selectedPreset = preset;
  }

  function handleDownload(url: string, fileName?: string) {
    const link = document.createElement('a');
    link.href = `${API_URL}${url}`;
    link.download = fileName || '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleClearJob(jobId: string) {
    clearJobData(jobId);
    activeJobs = activeJobs.filter((job) => job.id !== jobId);
  }

  function handleRetry(jobId: string) {
    handleClearJob(jobId);
    uploadError = 'Please re-upload the file to retry.';
  }

  function handleHistoryDownload(url: string, fileName: string) {
    handleDownload(url, fileName);
  }

  function handleHistoryRemove(id: string) {
    removeFromHistory(id);
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

    <!-- Rate limit banner -->
    {#if rateLimitStatus?.remaining === 0 || (rateLimitStatus && rateLimitStatus.remaining <= 3) || rateLimitError}
      <div class="mb-4">
        <RateLimitBanner
          status={rateLimitStatus}
          error={rateLimitError}
          onRefresh={refreshRateLimitStatus}
        />
      </div>
    {/if}

    <!-- Main card -->
    <div class="bg-white rounded-lg shadow-lg p-6 md:p-8 mb-6">
      <!-- File upload -->
      <FileUpload
        onFileSelect={handleFileSelect}
        {selectedPreset}
        {presets}
        onPresetChange={handlePresetChange}
        disabled={isUploading || rateLimitStatus?.remaining === 0}
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
            onDownload={(url) => handleDownload(url, job.fileName)}
            onRetry={() => handleRetry(job.id)}
            onCancel={() => handleClearJob(job.id)}
          />
        {/each}
      </div>
    {/if}

    <!-- Download History -->
    {#if $downloadHistory.length > 0}
      <div class="mb-6">
        <h2 class="text-lg font-semibold text-gray-900 mb-4">Recent Downloads</h2>
        <DownloadHistory
          items={$downloadHistory}
          onDownload={handleHistoryDownload}
          onRemove={handleHistoryRemove}
        />
      </div>
    {/if}

    <!-- Footer -->
    <div class="flex flex-col gap-2 text-xs text-gray-400">
      <div class="flex items-center justify-between">
        <p>Files are automatically deleted after 15 minutes. No account required.</p>
        <ConnectionStatus />
      </div>
      {#if rateLimitStatus && rateLimitStatus.remaining > 3}
        <div class="flex justify-center">
          <RateLimitBanner status={rateLimitStatus} />
        </div>
      {/if}
    </div>
  </div>
</main>
