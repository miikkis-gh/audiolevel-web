<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import FileUpload from './lib/components/FileUpload.svelte';
  import ProgressIndicator from './lib/components/ProgressIndicator.svelte';
  import ConnectionStatus from './lib/components/ConnectionStatus.svelte';
  import DownloadHistory from './lib/components/DownloadHistory.svelte';
  import RateLimitBanner from './lib/components/RateLimitBanner.svelte';
  import ErrorMessage from './lib/components/ErrorMessage.svelte';
  import OfflineBanner from './lib/components/OfflineBanner.svelte';
  import LoadingSkeleton from './lib/components/LoadingSkeleton.svelte';
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
  let uploadError = $state<ApiError | null>(null);
  let activeJobs = $state<Array<{ id: string; fileName: string; preset: string; outputFormat: string }>>([]);
  let cleanupInterval: ReturnType<typeof setInterval>;
  let rateLimitStatus = $state<RateLimitStatus | null>(null);
  let rateLimitError = $state<string | null>(null);
  let isLoadingPresets = $state(true);
  let presetsLoadError = $state<string | null>(null);

  // Mouse parallax state with smooth interpolation
  let mouseX = $state(0);
  let mouseY = $state(0);
  let targetX = 0;
  let targetY = 0;
  let blobContainer: HTMLDivElement;
  let animationFrameId: number;

  // API URL for downloads
  const API_URL = import.meta.env.VITE_API_URL || '';

  // Smooth lerp function for eased parallax
  function lerp(start: number, end: number, factor: number): number {
    return start + (end - start) * factor;
  }

  // Mouse move handler for parallax effect
  function handleMouseMove(e: MouseEvent) {
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;
    targetX = (clientX / innerWidth - 0.5) * 40;
    targetY = (clientY / innerHeight - 0.5) * 40;
  }

  // Animation loop for smooth parallax
  function animateParallax() {
    mouseX = lerp(mouseX, targetX, 0.08);
    mouseY = lerp(mouseY, targetY, 0.08);
    animationFrameId = requestAnimationFrame(animateParallax);
  }

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

    // Add mouse move listener for parallax
    window.addEventListener('mousemove', handleMouseMove);

    // Start parallax animation loop
    animateParallax();

    // Fetch presets and rate limit status in parallel
    isLoadingPresets = true;
    presetsLoadError = null;

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
      presetsLoadError = 'Failed to load presets. Please refresh the page.';
    } finally {
      isLoadingPresets = false;
    }

    // Clean up expired items periodically
    cleanupExpired();
    cleanupInterval = setInterval(cleanupExpired, 60000); // Every minute
  });

  onDestroy(() => {
    disconnectWebSocket();
    window.removeEventListener('mousemove', handleMouseMove);
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
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
      const error = new Error('Upload limit reached. Please wait for the limit to reset.') as ApiError;
      error.code = 'RATE_LIMITED';
      error.hint = 'You can upload up to 10 files per hour.';
      uploadError = error;
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
      uploadError = apiError;

      // Refresh rate limit status if it was a rate limit error
      if (apiError.status === 429) {
        await refreshRateLimitStatus();
      }
    } finally {
      isUploading = false;
    }
  }

  function clearUploadError() {
    uploadError = null;
  }

  function retryUpload() {
    uploadError = null;
    // The user will need to select a file again
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
    const error = new Error('Processing failed. Please re-upload the file to retry.') as ApiError;
    error.code = 'RETRY_NEEDED';
    error.hint = 'Select your file again and click upload.';
    uploadError = error;
  }

  function handleHistoryDownload(url: string, fileName: string) {
    handleDownload(url, fileName);
  }

  function handleHistoryRemove(id: string) {
    removeFromHistory(id);
  }
</script>

<!-- Animated gradient background -->
<div class="gradient-bg"></div>

<!-- Animated blobs with layered parallax depth -->
<div
  bind:this={blobContainer}
  class="fixed inset-0 overflow-hidden pointer-events-none z-[-1]"
>
  <!-- Background layer - slowest parallax -->
  <div class="blob blob-indigo animate-blob-1" style="transform: translate({mouseX * 0.3}px, {mouseY * 0.3}px)"></div>
  <!-- Mid-background layer -->
  <div class="blob blob-violet animate-blob-2" style="transform: translate({mouseX * 0.5}px, {mouseY * 0.5}px)"></div>
  <!-- Middle layer -->
  <div class="blob blob-sky animate-blob-3" style="transform: translate({mouseX * 0.7}px, {mouseY * 0.7}px)"></div>
  <!-- Mid-foreground layer -->
  <div class="blob blob-cyan animate-blob-4" style="transform: translate({mouseX * 0.9}px, {mouseY * 0.9}px)"></div>
  <!-- Foreground layer - fastest parallax -->
  <div class="blob blob-fuchsia animate-blob-5" style="transform: translate(calc(-50% + {mouseX * 1.2}px), calc(-50% + {mouseY * 1.2}px))"></div>
</div>

<!-- Noise texture overlay -->
<div class="noise-overlay"></div>

<!-- Offline banner -->
<OfflineBanner />

<main class="relative min-h-screen py-8 px-4 md:py-12 md:px-6">
  <div class="max-w-2xl mx-auto">
    <!-- Header -->
    <header class="text-center mb-10 animate-entrance">
      <div class="relative inline-flex items-center justify-center mb-6 group">
        <!-- Glow effect behind icon -->
        <div class="absolute inset-0 w-16 h-16 bg-gradient-to-br from-indigo-500/30 to-violet-500/30 rounded-2xl blur-xl opacity-60 group-hover:opacity-100 transition-opacity duration-500"></div>
        <!-- Floating icon container -->
        <div class="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl glass-card animate-float">
          <svg class="w-8 h-8 text-indigo-400 transition-transform duration-300 group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
      </div>
      <h1 class="text-4xl md:text-5xl font-semibold text-gradient mb-3 tracking-tight">AudioLevel</h1>
      <p class="text-white/50 text-lg max-w-md mx-auto">
        Professional audio normalization with industry-standard presets
      </p>
    </header>

    <!-- Presets load error -->
    {#if presetsLoadError}
      <div class="mb-6 animate-entrance stagger-1">
        <ErrorMessage
          error={presetsLoadError}
          onRetry={() => window.location.reload()}
        />
      </div>
    {/if}

    <!-- Rate limit banner -->
    {#if rateLimitStatus?.remaining === 0 || (rateLimitStatus && rateLimitStatus.remaining <= 3) || rateLimitError}
      <div class="mb-6 animate-entrance stagger-1">
        <RateLimitBanner
          status={rateLimitStatus}
          error={rateLimitError}
          onRefresh={refreshRateLimitStatus}
        />
      </div>
    {/if}

    <!-- Main card -->
    <div class="glass-card rounded-2xl p-6 md:p-8 mb-8 animate-entrance stagger-2">
      {#if isLoadingPresets}
        <!-- Loading skeleton -->
        <div class="space-y-6">
          <LoadingSkeleton variant="card" height="200px" />
          <div class="flex gap-3">
            <LoadingSkeleton variant="button" width="100px" />
            <LoadingSkeleton variant="button" width="100px" />
            <LoadingSkeleton variant="button" width="100px" />
          </div>
        </div>
      {:else}
        <!-- File upload -->
        <FileUpload
          onFileSelect={handleFileSelect}
          {selectedPreset}
          {presets}
          onPresetChange={handlePresetChange}
          disabled={isUploading || rateLimitStatus?.remaining === 0}
        />
      {/if}

      <!-- Upload error -->
      {#if uploadError}
        <div class="mt-6">
          <ErrorMessage
            error={uploadError}
            onRetry={retryUpload}
            onDismiss={clearUploadError}
          />
        </div>
      {/if}

      <!-- Uploading indicator -->
      {#if isUploading}
        <div class="mt-6 flex items-center justify-center gap-3 text-white/50">
          <svg class="animate-spin h-5 w-5 text-indigo-400" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Uploading your file...</span>
        </div>
      {/if}
    </div>

    <!-- Active jobs -->
    {#if activeJobs.length > 0}
      <section class="mb-8 animate-entrance stagger-3">
        <h2 class="text-lg font-medium text-white/90 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Processing
        </h2>
        <div class="space-y-4">
          {#each activeJobs as job, i (job.id)}
            <div class="animate-entrance" style="animation-delay: {i * 0.1}s">
              <ProgressIndicator
                jobId={job.id}
                fileName={job.fileName}
                onDownload={(url) => handleDownload(url, job.fileName)}
                onRetry={() => handleRetry(job.id)}
                onCancel={() => handleClearJob(job.id)}
              />
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Download History -->
    {#if $downloadHistory.length > 0}
      <section class="mb-8 animate-entrance stagger-4">
        <h2 class="text-lg font-medium text-white/90 mb-4 flex items-center gap-2">
          <svg class="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Recent Downloads
        </h2>
        <DownloadHistory
          items={$downloadHistory}
          onDownload={handleHistoryDownload}
          onRemove={handleHistoryRemove}
        />
      </section>
    {/if}

    <!-- Footer -->
    <footer class="animate-entrance stagger-5">
      <div class="glass-card rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p class="text-sm text-white/40 text-center sm:text-left">
          Files are automatically deleted after 15 minutes. No account required.
        </p>
        <div class="flex items-center gap-4">
          {#if rateLimitStatus && rateLimitStatus.remaining > 3}
            <RateLimitBanner status={rateLimitStatus} />
          {/if}
          <ConnectionStatus />
        </div>
      </div>
    </footer>
  </div>
</main>
