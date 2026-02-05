<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import JSZip from 'jszip';
  import ParticleSphere from './ParticleSphere.svelte';
  import SingleReport from './SingleReport.svelte';
  import BatchReport from './BatchReport.svelte';
  import RatingToast from './RatingToast.svelte';
  import AboutModal from './AboutModal.svelte';
  import ActivityPanel from './ActivityPanel.svelte';
  import {
    SINGLE_REPORT,
    MAX_BATCH,
    BATCH_MOCK_POOL,
    PROFILE_COLORS,
    type Mode,
    type ParticleState,
    type SingleReportData,
    type BatchReportData,
    type BatchFile,
    type OverrideType,
  } from './constants';
  import { getStageLabel, getLayout, getPositions, truncName } from './helpers';
  import { uploadFile, getDownloadUrl, getJobStatus, fetchRateLimitStatus, submitRating, type ApiError, type JobResult, type RateLimitStatus, type RatingPayload } from '../../../stores/api';
  import {
    connectWebSocket,
    disconnectWebSocket,
    subscribeToJob,
    clearJobData,
    jobProgress,
    jobResults,
    getWsUrl,
  } from '../../../stores/websocket';

  // State
  let mode = $state<Mode>('idle');
  let progress = $state(0);
  let fileName = $state('');
  let batchFiles = $state<BatchFile[]>([]);
  let spread = $state(false);
  let showReport = $state(false);
  let reportReady = $state(false);
  let reportIndex = $state(0);
  let dragOver = $state(false);
  let overrideOpen = $state(false);
  let reprocessing = $state(false);
  let singleReport = $state<SingleReportData>({ ...SINGLE_REPORT });
  let rejectMsg = $state('');
  let rejectPulse = $state(false);
  let errorState = $state<{ message: string; hint?: string } | null>(null);
  let downloadDropdownOpen = $state(false);
  let zipping = $state(false);
  let rateLimitStatus = $state<RateLimitStatus | null>(null);
  let now = $state(Date.now());

  // About modal state
  let showAboutModal = $state(false);

  // Rating toast state
  let showRatingToast = $state(false);
  let ratingJobId = $state<string | null>(null);
  let ratingFileName = $state<string>('');
  let ratingReport = $state<SingleReportData | null>(null);
  let pendingBatchDownloads = $state(0);

  // Job tracking
  let currentJobId = $state<string | null>(null);
  let currentDownloadUrl = $state<string | null>(null);

  // Non-reactive refs
  let fileInput: HTMLInputElement;
  let mergeTriggered = false;
  let rejectTimer: ReturnType<typeof setTimeout> | null = null;
  let overrideTimer: ReturnType<typeof setTimeout> | null = null;
  let dragCount = 0;
  let unsubscribeProgress: (() => void) | null = null;
  let unsubscribeResults: (() => void) | null = null;
  let rateLimitInterval: ReturnType<typeof setInterval> | null = null;
  let nowInterval: ReturnType<typeof setInterval> | null = null;

  // Fallback processing display info (when no profile detection available)
  const PROCESSING_FALLBACK = {
    mastering: {
      displayName: 'Music / Song',
      standard: 'Streaming (Spotify / Apple Music / YouTube)',
      target: '-14 LUFS / -1 dBTP',
    },
    normalization: {
      displayName: 'Normalized Audio',
      standard: 'Broadcast Standard',
      target: '-16 LUFS / -1 dBTP',
    },
    'peak-normalization': {
      displayName: 'SFX / Sample',
      standard: 'SFX / Sample library',
      target: 'Peak normalize to -1 dBFS',
    },
    intelligent: {
      displayName: 'Audio',
      standard: 'Intelligent Processing',
      target: 'Adaptive',
    },
  };

  // Error helper functions
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  function setError(message: string, hint?: string, autoHideMs?: number) {
    errorState = { message, hint };
    if (errorTimer) clearTimeout(errorTimer);
    if (autoHideMs) {
      errorTimer = setTimeout(() => (errorState = null), autoHideMs);
    }
  }

  function clearError() {
    errorState = null;
    if (errorTimer) clearTimeout(errorTimer);
  }

  // Format number for display
  function formatLufs(value: number | undefined): string {
    if (value === undefined) return 'N/A';
    return `${value.toFixed(1)} LUFS`;
  }

  function formatTruePeak(value: number | undefined): string {
    if (value === undefined) return 'N/A';
    return `${value.toFixed(1)} dBTP`;
  }

  function formatLra(value: number | undefined): string {
    if (value === undefined) return 'N/A';
    return `${value.toFixed(1)} LU`;
  }

  // Build report from job result
  function buildReportFromResult(result: JobResult): SingleReportData {
    const profile = result.detectedProfile;
    const processingType = result.processingType || 'mastering';
    const report = result.processingReport;
    const fallback = PROCESSING_FALLBACK[processingType] || PROCESSING_FALLBACK.mastering;

    // Use detected profile data if available, otherwise use fallback
    const displayName = profile?.label || fallback.displayName;
    const standard = profile?.standard || fallback.standard;
    const target = profile
      ? `${profile.targetLufs} LUFS / ${profile.targetTruePeak} dBTP`
      : fallback.target;
    const confidence = profile?.confidence || 'HIGH';

    const notes: string[] = [];

    // Build notes based on processing
    if (processingType === 'mastering') {
      if (result.masteringDecisions?.compressionEnabled) {
        notes.push('Compression applied — dynamic range was high');
      }
      if (result.masteringDecisions?.saturationEnabled) {
        notes.push('Saturation applied — added harmonic warmth');
      }
    }

    if (result.inputAnalysis && result.outputAnalysis) {
      const inputPeak = result.inputAnalysis.inputTruePeak;
      if (inputPeak !== undefined && inputPeak > -1) {
        notes.push(`True peak exceeded -1 dBTP (was ${inputPeak.toFixed(1)} dBTP) — limiter applied`);
      }
      const gainChange = (result.outputAnalysis.inputLufs || 0) - (result.inputAnalysis.inputLufs || 0);
      if (Math.abs(gainChange) > 3) {
        notes.push(`Gain ${gainChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(gainChange).toFixed(1)} dB`);
      }
    }

    if (notes.length === 0) {
      notes.push('Processing completed successfully');
    }

    // Build reasons from profile detection or use processing info
    const reasons = profile?.reasons.map(r => ({
      signal: r.signal,
      detail: r.detail,
    })) || [
      { signal: `Processing: ${processingType}`, detail: 'processing method used' },
      { signal: `Duration: ${result.duration ? `${(result.duration / 1000).toFixed(1)}s` : 'N/A'}`, detail: 'processing time' },
    ];

    // Build intelligent processing report if available
    const intelligentProcessing = report ? {
      problemsDetected: report.problemsDetected.map(p => ({
        problem: p.problem,
        details: p.details,
        severity: (p.severity as 'mild' | 'moderate' | 'severe') || undefined,
      })),
      processingApplied: report.processingApplied,
      candidatesTested: report.candidatesTested,
      winnerReason: report.winnerReason,
      qualityMethod: report.qualityMethod,
    } : undefined;

    return {
      detectedAs: displayName,
      confidence,
      reasons,
      before: {
        integrated: formatLufs(result.inputAnalysis?.inputLufs),
        truePeak: formatTruePeak(result.inputAnalysis?.inputTruePeak),
        lra: formatLra(result.inputAnalysis?.inputLoudnessRange),
      },
      after: {
        integrated: formatLufs(result.outputAnalysis?.inputLufs),
        truePeak: formatTruePeak(result.outputAnalysis?.inputTruePeak),
        lra: formatLra(result.outputAnalysis?.inputLoudnessRange),
      },
      target,
      standard,
      notes,
      intelligentProcessing,
    };
  }

  // Build batch report from job result
  function buildBatchReportFromResult(result: JobResult): BatchReportData {
    const single = buildReportFromResult(result);
    return {
      type: single.detectedAs,
      conf: single.confidence,
      reasons: single.reasons,
      before: single.before,
      after: single.after,
      target: single.target,
      standard: single.standard,
      notes: single.notes,
      intelligentProcessing: single.intelligentProcessing,
    };
  }

  // Convert batch report back to single report for rating
  function buildReportFromBatchReport(batch: BatchReportData): SingleReportData {
    return {
      detectedAs: batch.type,
      confidence: batch.conf,
      reasons: batch.reasons,
      before: batch.before,
      after: batch.after,
      target: batch.target,
      standard: batch.standard,
      notes: batch.notes,
      intelligentProcessing: batch.intelligentProcessing,
    };
  }

  // Fetch full job details and update report
  async function fetchAndUpdateReport(jobId: string): Promise<JobResult | null> {
    try {
      const status = await getJobStatus(jobId);
      if (status.result) {
        return status.result;
      }
    } catch (err) {
      console.error('Failed to fetch job details:', err);
    }
    return null;
  }

  // Track which jobs we've already processed for completion
  let processedCompletions = new Set<string>();

  // Connect WebSocket on mount
  onMount(() => {
    connectWebSocket();

    // Fetch rate limit status
    async function updateRateLimit() {
      try {
        rateLimitStatus = await fetchRateLimitStatus();
      } catch {
        // Ignore errors
      }
    }
    updateRateLimit();
    rateLimitInterval = setInterval(updateRateLimit, 30000); // Update every 30s
    nowInterval = setInterval(() => { now = Date.now(); }, 1000); // Update timer every second

    // Subscribe to progress updates
    unsubscribeProgress = jobProgress.subscribe(($progress: Map<string, { percent: number; stage?: string }>) => {
      // Update single file progress
      if (currentJobId && mode === 'processing') {
        const jobProg = $progress.get(currentJobId);
        if (jobProg) {
          progress = jobProg.percent;
        }
      }

      // Update batch file progress (check batchFiles.length instead of mode to avoid race conditions)
      if (batchFiles.length > 0 && mode !== 'idle' && mode !== 'processing' && mode !== 'complete') {
        batchFiles = batchFiles.map((f) => {
          if (!f.jobId) return f;
          const jobProg = $progress.get(f.jobId);
          if (jobProg) {
            return {
              ...f,
              progress: jobProg.percent,
              fileState: jobProg.percent >= 100 ? 'complete' : jobProg.percent > 0 ? 'processing' : 'pending',
            };
          }
          return f;
        });
      }
    });

    // Subscribe to job results
    unsubscribeResults = jobResults.subscribe(($results: Map<string, { success: boolean; downloadUrl?: string; error?: string }>) => {
      // Handle single file completion
      if (currentJobId && mode === 'processing' && !processedCompletions.has(currentJobId)) {
        const result = $results.get(currentJobId);
        if (result) {
          if (result.success && result.downloadUrl) {
            processedCompletions.add(currentJobId);
            progress = 100;
            currentDownloadUrl = result.downloadUrl;

            // Fetch full job details for report
            fetchAndUpdateReport(currentJobId).then((jobResult) => {
              if (jobResult) {
                singleReport = buildReportFromResult(jobResult);
              }
            });

            setTimeout(() => {
              mode = 'complete';
              setTimeout(() => (reportReady = true), 600);
            }, 400);
          } else if (result.error) {
            setError(result.error);
            mode = 'idle';
          }
        }
      }

      // Handle batch file completion (check batchFiles.length instead of mode to avoid race conditions)
      if (batchFiles.length > 0 && mode !== 'idle' && mode !== 'processing' && mode !== 'complete') {
        batchFiles = batchFiles.map((f) => {
          if (!f.jobId) return f;
          const result = $results.get(f.jobId);
          if (result) {
            if (result.success && result.downloadUrl) {
              // Fetch full job details for report if not already done
              if (!processedCompletions.has(f.jobId)) {
                processedCompletions.add(f.jobId);
                fetchAndUpdateReport(f.jobId).then((jobResult) => {
                  if (jobResult) {
                    batchFiles = batchFiles.map((bf) => {
                      if (bf.jobId === f.jobId) {
                        return { ...bf, report: buildBatchReportFromResult(jobResult) };
                      }
                      return bf;
                    });
                  }
                });
              }
              return { ...f, progress: 100, fileState: 'complete', downloadUrl: result.downloadUrl };
            } else if (result.error) {
              return { ...f, fileState: 'error', error: result.error };
            }
          }
          return f;
        });
      }
    });
  });

  onDestroy(() => {
    unsubscribeProgress?.();
    unsubscribeResults?.();
    disconnectWebSocket();
    if (rateLimitInterval) clearInterval(rateLimitInterval);
    if (nowInterval) clearInterval(nowInterval);
  });

  // Close dropdown when clicking outside
  $effect(() => {
    if (!downloadDropdownOpen) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('.download-dropdown')) {
        downloadDropdownOpen = false;
      }
    }

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  });

  // Single-file processing - no mock needed, progress comes from WebSocket
  $effect(() => {
    if (mode !== 'processing') return;
    reportReady = false;
    showReport = false;
  });

  // Split animation effect
  $effect(() => {
    if (mode !== 'splitting') return;
    let cancelled = false;
    let splitTimeout: ReturnType<typeof setTimeout> | null = null;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        spread = true;
        splitTimeout = setTimeout(() => {
          if (!cancelled) mode = 'batch';
        }, 750);
      });
    });

    return () => {
      cancelled = true;
      if (splitTimeout) clearTimeout(splitTimeout);
    };
  });

  // Batch processing - progress comes from WebSocket, no mock simulation needed
  // The progress is updated via the jobProgress subscription in onMount

  // Batch completion → merge effect
  // Use a ref to track the timeout so it's not cleared on re-runs
  let mergeTimeout: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (
      mode === 'batch' &&
      !mergeTriggered &&
      batchFiles.length > 0 &&
      batchFiles.every((f) => f.fileState === 'complete' || f.fileState === 'error')
    ) {
      mergeTriggered = true;
      // Don't return cleanup - we want the timeout to complete even if effect re-runs
      mergeTimeout = setTimeout(() => (mode = 'merging'), 800);
    }
  });

  // Merge animation effect
  $effect(() => {
    if (mode !== 'merging') return;
    spread = false;
    let innerT: ReturnType<typeof setTimeout> | null = null;
    const t = setTimeout(() => {
      mode = 'batch-complete';
      innerT = setTimeout(() => (reportReady = true), 600);
    }, 850);

    return () => {
      clearTimeout(t);
      if (innerT) clearTimeout(innerT);
    };
  });

  // Handlers
  async function uploadSingleFile(file: File) {
    try {
      clearError();
      const response = await uploadFile(file);
      currentJobId = response.jobId;
      subscribeToJob(response.jobId);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || 'Upload failed', apiError.hint);
      mode = 'idle';
    }
  }

  async function startBatch(files: File[]) {
    const batchData: BatchFile[] = files.map((file, i) => ({
      id: `f-${i}-${Date.now()}`,
      name: file.name,
      progress: 0,
      fileState: 'pending',
      report: BATCH_MOCK_POOL[i % BATCH_MOCK_POOL.length], // Will be replaced with real data
    }));
    batchFiles = batchData;
    mergeTriggered = false;
    reportReady = false;
    showReport = false;
    mode = 'splitting';

    // Upload all files
    for (let i = 0; i < files.length; i++) {
      try {
        const response = await uploadFile(files[i]);
        batchFiles = batchFiles.map((f, idx) => {
          if (idx === i) {
            return { ...f, jobId: response.jobId };
          }
          return f;
        });
        subscribeToJob(response.jobId);
      } catch (err) {
        const apiError = err as ApiError;
        batchFiles = batchFiles.map((f, idx) => {
          if (idx === i) {
            return { ...f, fileState: 'error', error: apiError.message || 'Upload failed' };
          }
          return f;
        });
      }
    }
  }

  function showReject(count: number) {
    if (rejectTimer) clearTimeout(rejectTimer);
    rejectMsg = `Drop up to ${MAX_BATCH} files at a time (${count} selected)`;
    rejectPulse = true;
    rejectTimer = setTimeout(() => (rejectMsg = ''), 3500);
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCount = 0;
    dragOver = false;
    if (mode !== 'idle') return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    if (files.length > MAX_BATCH) {
      showReject(files.length);
      return;
    }
    if (files.length === 1) {
      fileName = files[0].name;
      progress = 0;
      mode = 'processing';
      uploadSingleFile(files[0]);
    } else {
      startBatch(files);
    }
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    dragCount++;
    if (mode === 'idle') dragOver = true;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCount--;
    if (dragCount <= 0) {
      dragCount = 0;
      dragOver = false;
    }
  }

  function handleSphereClick() {
    if (mode === 'idle') fileInput?.click();
  }

  function handleSphereKeyDown(e: KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ' ') && mode === 'idle') {
      e.preventDefault();
      fileInput?.click();
    }
  }

  function handleFileInput(e: Event) {
    if (mode !== 'idle') return;
    const target = e.target as HTMLInputElement;
    const files = Array.from(target.files || []);
    if (!files.length) return;
    if (files.length > MAX_BATCH) {
      showReject(files.length);
      target.value = '';
      return;
    }
    if (files.length === 1) {
      fileName = files[0].name;
      progress = 0;
      mode = 'processing';
      uploadSingleFile(files[0]);
    } else {
      startBatch(files);
    }
    target.value = '';
  }

  function reset() {
    // Clear job subscriptions
    if (currentJobId) {
      clearJobData(currentJobId);
      currentJobId = null;
    }
    batchFiles.forEach((f) => {
      if (f.jobId) clearJobData(f.jobId);
    });

    mode = 'idle';
    progress = 0;
    showReport = false;
    reportReady = false;
    reportIndex = 0;
    fileName = '';
    batchFiles = [];
    spread = false;
    overrideOpen = false;
    reprocessing = false;
    singleReport = { ...SINGLE_REPORT };
    rejectMsg = '';
    clearError();
    currentDownloadUrl = null;
    processedCompletions = new Set();
    showRatingToast = false;
    ratingJobId = null;
    ratingFileName = '';
    ratingReport = null;
    pendingBatchDownloads = 0;
    if (rejectTimer) clearTimeout(rejectTimer);
    if (overrideTimer) clearTimeout(overrideTimer);
    if (mergeTimeout) clearTimeout(mergeTimeout);
    mergeTriggered = false;
  }

  function handleOverride(overrideType: OverrideType) {
    overrideOpen = false;
    reprocessing = true;
    if (overrideTimer) clearTimeout(overrideTimer);

    overrideTimer = setTimeout(() => {
      if (mode === 'batch-complete') {
        batchFiles = batchFiles.map((f, i) => {
          if (i !== reportIndex) return f;
          return {
            ...f,
            report: {
              ...f.report,
              type: overrideType.label,
              conf: 'OVERRIDE',
              target: overrideType.target,
              standard: overrideType.standard,
              notes: [
                ...f.report.notes.filter((n) => !n.startsWith('Overridden')),
                `Overridden from auto-detected type — reprocessed as ${overrideType.label}`,
              ],
            },
          };
        });
      } else if (mode === 'complete') {
        singleReport = {
          ...singleReport,
          detectedAs: overrideType.label,
          confidence: 'OVERRIDE',
          target: overrideType.target,
          standard: overrideType.standard,
          notes: [
            ...singleReport.notes.filter((n) => !n.startsWith('Overridden')),
            `Overridden from auto-detected type — reprocessed as ${overrideType.label}`,
          ],
        };
      }
      reprocessing = false;
    }, 1200);
  }

  function handleReportKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showReport = false;
      overrideOpen = false;
    }
    if (mode === 'batch-complete' && batchFiles.length > 1) {
      if (e.key === 'ArrowLeft') {
        navigateBatchReport(Math.max(0, reportIndex - 1));
      }
      if (e.key === 'ArrowRight') {
        navigateBatchReport(Math.min(batchFiles.length - 1, reportIndex + 1));
      }
    }
  }

  function handleDownload() {
    if (currentJobId && currentDownloadUrl) {
      triggerDownload(currentDownloadUrl, fileName);
    } else if (currentJobId) {
      triggerDownload(getDownloadUrl(currentJobId), fileName);
    }
    // Always show rating toast after download attempt
    showRatingToastAfterDownload(currentJobId || 'unknown', fileName || 'file', singleReport);
  }

  function handleBatchDownload(index?: number) {
    downloadDropdownOpen = false;
    if (index !== undefined) {
      const file = batchFiles[index];
      if (file?.jobId) {
        const url = file.downloadUrl || getDownloadUrl(file.jobId);
        triggerDownload(url, file.name);
        // Show rating toast for single file from batch
        const reportData = buildReportFromBatchReport(file.report);
        showRatingToastAfterDownload(file.jobId, file.name, reportData);
      }
    } else {
      // Download all - stagger to avoid popup blocker
      const completedFiles = batchFiles.filter((f) => f.jobId && f.fileState === 'complete');
      pendingBatchDownloads = completedFiles.length;
      completedFiles.forEach((file, i) => {
        setTimeout(() => {
          const url = file.downloadUrl || getDownloadUrl(file.jobId!);
          triggerDownload(url, file.name);
          pendingBatchDownloads--;
          // Show rating toast after last download completes
          if (pendingBatchDownloads === 0 && completedFiles.length > 0) {
            const firstFile = completedFiles[0];
            const reportData = buildReportFromBatchReport(firstFile.report);
            showRatingToastAfterDownload(firstFile.jobId!, `${completedFiles.length} files`, reportData);
          }
        }, i * 300); // 300ms delay between each download
      });
    }
  }

  async function handleBatchDownloadZip() {
    downloadDropdownOpen = false;
    zipping = true;

    try {
      const zip = new JSZip();
      const completedFiles = batchFiles.filter((f) => f.jobId && f.fileState === 'complete');

      // Fetch all files and add to zip
      await Promise.all(
        completedFiles.map(async (file) => {
          const url = file.downloadUrl || getDownloadUrl(file.jobId!);
          const response = await fetch(url);
          if (response.ok) {
            const blob = await response.blob();
            zip.file(file.name, blob);
          }
        })
      );

      // Generate and download ZIP
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipUrl = URL.createObjectURL(zipBlob);
      triggerDownload(zipUrl, 'audiolevel-processed.zip');
      URL.revokeObjectURL(zipUrl);

      // Show rating toast after ZIP download using first file's report
      if (completedFiles.length > 0) {
        const firstFile = completedFiles[0];
        const reportData = buildReportFromBatchReport(firstFile.report);
        showRatingToastAfterDownload(firstFile.jobId!, `${completedFiles.length} files (ZIP)`, reportData);
      }
    } catch (err) {
      console.error('Failed to create ZIP:', err);
      setError('Failed to create ZIP file', 'Try downloading files individually', 3000);
    } finally {
      zipping = false;
    }
  }

  // Use anchor element to trigger download (bypasses popup blocker)
  function triggerDownload(url: string, filename: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Show rating toast after download
  function showRatingToastAfterDownload(jobId: string, name: string, report: SingleReportData) {
    ratingJobId = jobId;
    ratingFileName = name;
    ratingReport = report;
    showRatingToast = true;
  }

  // Handle rating submission
  function handleRating(rating: 'up' | 'down') {
    if (ratingJobId && ratingReport) {
      const payload: RatingPayload = {
        jobId: ratingJobId,
        rating,
        fileName: ratingFileName,
        report: {
          contentType: ratingReport.detectedAs,
          contentConfidence: ratingReport.confidence,
          qualityMethod: ratingReport.intelligentProcessing?.qualityMethod,
          inputMetrics: {
            lufs: ratingReport.before.integrated,
            truePeak: ratingReport.before.truePeak,
            lra: ratingReport.before.lra,
          },
          outputMetrics: {
            lufs: ratingReport.after.integrated,
            truePeak: ratingReport.after.truePeak,
            lra: ratingReport.after.lra,
          },
          problemsDetected: ratingReport.intelligentProcessing?.problemsDetected.map(p => ({
            problem: p.problem,
            details: p.details,
            severity: p.severity,
          })),
          processingApplied: ratingReport.intelligentProcessing?.processingApplied,
          candidatesTested: ratingReport.intelligentProcessing?.candidatesTested,
        },
      };
      submitRating(payload);
    }
    dismissRatingToast();
  }

  // Dismiss rating toast
  function dismissRatingToast() {
    showRatingToast = false;
    ratingJobId = null;
    ratingFileName = '';
    ratingReport = null;
    pendingBatchDownloads = 0;
  }

  function navigateBatchReport(index: number) {
    reportIndex = index;
    overrideOpen = false;
  }

  // Computed values
  let layout = $derived(getLayout(batchFiles.length || 1));
  let positions = $derived(getPositions(batchFiles.length || 1, layout.radius));
  let showLarge = $derived(['idle', 'processing', 'complete', 'batch-complete'].includes(mode));
  let batchActive = $derived(['splitting', 'batch', 'merging'].includes(mode));
  let overallProg = $derived(
    batchFiles.length
      ? Math.floor(batchFiles.reduce((s, f) => s + f.progress, 0) / batchFiles.length)
      : 0
  );
  let doneCount = $derived(batchFiles.filter((f) => f.progress >= 100).length);

  let largePState = $derived<ParticleState>(
    mode === 'complete' || mode === 'batch-complete'
      ? 'complete'
      : mode === 'processing'
        ? 'processing'
        : 'idle'
  );
  let largeProgress = $derived(
    mode === 'complete' || mode === 'batch-complete' ? 100 : mode === 'processing' ? progress : 0
  );

  let infoMarginTop = $derived(batchActive ? layout.radius + layout.size / 2 + 24 : 40);

  let currentBatchFile = $derived(batchFiles[reportIndex]);

  let floorGlowBg = $derived.by(() => {
    if (mode === 'processing' || mode === 'complete') {
      const pc = PROFILE_COLORS[singleReport.detectedAs];
      if (pc) return `rgba(${pc[0]},${pc[1]},${pc[2]},${mode === 'complete' ? 0.18 : 0.14})`;
    }
    return 'rgba(60,160,220,.06)';
  });
</script>

<div
  class="audiolevel-root"
  role="application"
  ondrop={handleDrop}
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="audio/*,.wav,.mp3,.flac,.aac,.ogg,.m4a,.aiff,.aif,.opus,.wma,.webm,.mka,.caf,.au,.snd,.amr,.wv,.ape,.ac3,.dts,.mp2"
    multiple
    style="display: none"
    onchange={handleFileInput}
  />

  <button class="branding" onclick={() => showAboutModal = true} aria-label="About AudioLevel">
    <span class="branding-text">AudioLevel</span>
    <span class="branding-dot"></span>
  </button>

  {#if rejectMsg}
    <div class="reject-msg">{rejectMsg}</div>
  {/if}

  {#if errorState}
    <div class="error-msg">
      <span class="error-message">{errorState.message}</span>
      {#if errorState.hint}
        <span class="error-hint">{errorState.hint}</span>
      {/if}
    </div>
  {/if}

  <!-- Sphere area -->
  <div style="position: relative">
    <!-- Large sphere -->
    <div
      class="sphere-container"
      onclick={handleSphereClick}
      onkeydown={handleSphereKeyDown}
      role="button"
      tabindex={mode === 'idle' ? 0 : -1}
      aria-label={mode === 'idle'
        ? 'Upload audio file'
        : mode === 'processing'
          ? `Processing: ${progress}%`
          : mode === 'complete'
            ? 'Processing complete'
            : mode === 'batch-complete'
              ? 'Batch processing complete'
              : 'Processing'}
      style="opacity: {showLarge ? 1 : 0}; transform: scale({showLarge
        ? 1
        : 0.5}); transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); pointer-events: {showLarge
        ? 'auto'
        : 'none'}; cursor: {mode === 'idle' ? 'pointer' : 'default'};"
    >
      <ParticleSphere
        size={152}
        progress={largeProgress}
        pState={dragOver ? 'idle' : largePState}
        profileColor={mode === 'processing' || mode === 'complete'
          ? PROFILE_COLORS[singleReport.detectedAs] || null
          : null}
        extraClass={rejectPulse ? 'reject-pulse' : ''}
        onanimationend={(e) => {
          if (e.animationName === 'rejectPulse') rejectPulse = false;
        }}
      />
      <div class="floor-glow" style="background: {floorGlowBg};"></div>
    </div>

    <!-- Drag-over visual on the large sphere -->
    {#if dragOver && showLarge}
      <div class="drag-overlay"></div>
    {/if}

    <!-- Mini spheres anchor -->
    <div class="mini-anchor">
      {#each batchFiles as file, i (file.id)}
        {@const pos = positions[i] || { x: 0, y: 0 }}
        {@const isMerging = mode === 'merging'}
        <div
          style="position: absolute; left: 0; top: 0; transform: {spread
            ? `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(1)`
            : `translate(-50%, -50%) scale(${isMerging ? 0.6 : 0})`}; opacity: {!spread && isMerging
            ? 0
            : spread
              ? 1
              : 0}; transition: all 0.7s cubic-bezier(0.4, 0, 0.2, 1) {i * 40}ms;"
        >
          <ParticleSphere
            size={layout.size}
            progress={file.progress}
            pState={file.progress >= 100 ? 'complete' : file.progress > 0 ? 'processing' : 'idle'}
            profileColor={PROFILE_COLORS[file.report.type] || null}
            mini
          />
          <div class="mini-label" style="max-width: {layout.size + 24}px">
            {truncName(file.name)}
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Info area below -->
  <div
    style="margin-top: {infoMarginTop}px; min-height: 100px; transition: margin-top 0.6s cubic-bezier(0.4, 0, 0.2, 1);"
  >
    {#if mode === 'idle'}
      <div class="idle-label">
        {dragOver ? 'Release to process' : 'Drop audio files or click'}
      </div>
      <div class="explainer">
        Normalize your audio to broadcast standards.<br />
        Drop files → auto-detect content type → download processed audio.<br />
        <span class="explainer-hint">After processing, tap the icon in the bottom right for a detailed analysis report.</span>
      </div>
    {/if}

    {#if mode === 'processing'}
      <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div class="progress-num">{progress}%</div>
        <div class="stage-label">{getStageLabel(progress)}</div>
      </div>
    {/if}

    {#if mode === 'complete'}
      <div class="complete-area">
        <div class="file-name">{fileName}</div>
        <button class="download-btn" onclick={handleDownload}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </button>
        <div>
          <button class="reset-btn" onclick={reset}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Process another
          </button>
        </div>
        {#if showRatingToast}
          <RatingToast
            visible={showRatingToast}
            onRate={handleRating}
            onDismiss={dismissRatingToast}
          />
        {/if}
      </div>
    {/if}

    {#if mode === 'splitting'}
      <div class="stage-label" style="animation: fadeUp 0.4s ease-out">
        Preparing {batchFiles.length} files
      </div>
    {/if}

    {#if mode === 'batch'}
      <div role="progressbar" aria-valuenow={overallProg} aria-valuemin={0} aria-valuemax={100}>
        <div class="progress-num">{overallProg}%</div>
        <div class="stage-label">{doneCount} of {batchFiles.length} complete</div>
      </div>
    {/if}

    {#if mode === 'merging'}
      <div class="stage-label" style="animation: fadeUp 0.3s ease-out">Finalizing batch</div>
    {/if}

    {#if mode === 'batch-complete'}
      <div class="complete-area">
        <div class="file-name">{batchFiles.filter(f => f.fileState === 'complete').length} of {batchFiles.length} files processed</div>
        <div class="download-dropdown">
          <button class="download-btn" onclick={() => handleBatchDownload()} disabled={zipping}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {zipping ? 'Creating ZIP...' : 'Download All'}
          </button>
          <button
            class="download-btn dropdown-toggle"
            onclick={() => (downloadDropdownOpen = !downloadDropdownOpen)}
            disabled={zipping}
            aria-label="Download options"
            aria-expanded={downloadDropdownOpen}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {#if downloadDropdownOpen}
            <div class="dropdown-menu">
              <button onclick={() => handleBatchDownload()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Individual files
              </button>
              <button onclick={handleBatchDownloadZip}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <line x1="9" y1="14" x2="15" y2="14" />
                </svg>
                Download as ZIP
              </button>
            </div>
          {/if}
        </div>
        <div>
          <button class="reset-btn" onclick={reset}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Process another
          </button>
        </div>
        {#if showRatingToast}
          <RatingToast
            visible={showRatingToast}
            onRate={handleRating}
            onDismiss={dismissRatingToast}
          />
        {/if}
      </div>
    {/if}
  </div>

  <!-- Report trigger -->
  <button
    class="report-trigger"
    class:visible={reportReady}
    onclick={() => (showReport = true)}
    title="View analysis report"
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" class="rt-icon">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  </button>

  <!-- Report panel -->
  {#if showReport}
    <div
      class="report-backdrop"
      onclick={() => {
        showReport = false;
        overrideOpen = false;
      }}
      role="presentation"
    ></div>
    <div class="report-panel" role="dialog" aria-label="Analysis report" tabindex="-1" onkeydown={handleReportKeyDown}>
      <button
        class="report-close"
        aria-label="Close report"
        onclick={() => {
          showReport = false;
          overrideOpen = false;
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {#if mode === 'batch-complete' && currentBatchFile}
        <BatchReport
          files={batchFiles}
          currentIndex={reportIndex}
          {reprocessing}
          {overrideOpen}
          onNavigate={navigateBatchReport}
          onToggleOverride={() => (overrideOpen = !overrideOpen)}
          onOverride={handleOverride}
        />
      {:else}
        <SingleReport
          report={singleReport}
          {reprocessing}
          {overrideOpen}
          onToggleOverride={() => (overrideOpen = !overrideOpen)}
          onOverride={handleOverride}
        />
      {/if}
    </div>
  {/if}

  <!-- Status bar -->
  <div class="status-bar">
    {#if rateLimitStatus}
      <div class="status-item">
        <span class="status-label">Uploads</span>
        <span class="status-value" class:warning={rateLimitStatus.remaining <= 3} class:critical={rateLimitStatus.remaining === 0}>
          {rateLimitStatus.remaining}/{rateLimitStatus.limit}
        </span>
      </div>
      <div class="status-divider"></div>
      {@const remaining = Math.max(0, rateLimitStatus.resetAt - now)}
      <div class="status-item">
        <span class="status-label">Resets</span>
        <span class="status-value">
          {Math.floor(remaining / 60000)}:{Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0')}
        </span>
      </div>
    {/if}
  </div>

  <!-- About modal -->
  <AboutModal
    visible={showAboutModal}
    onClose={() => showAboutModal = false}
  />

  <!-- Activity panel -->
  <ActivityPanel wsUrl={getWsUrl()} />
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500;600&family=IBM+Plex+Mono:wght@300;400;500&display=swap');

  .audiolevel-root {
    min-height: 100vh;
    background: #06070b;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    font-family: 'Outfit', sans-serif;
    box-sizing: border-box;
  }

  .audiolevel-root *,
  .audiolevel-root *::before,
  .audiolevel-root *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  .branding {
    position: fixed;
    top: 24px;
    left: 28px;
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.28);
    user-select: none;
    z-index: 60;
    background: none;
    border: none;
    padding: 4px 8px;
    margin: -4px -8px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .branding-text {
    position: relative;
  }

  .branding-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(80, 210, 180, 0.6);
    box-shadow: 0 0 8px rgba(80, 210, 180, 0.4);
    animation: dotPulse 3s ease-in-out infinite;
  }

  .branding:hover {
    color: rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.04);
  }

  .branding:hover .branding-dot {
    background: rgba(80, 210, 180, 0.9);
    box-shadow: 0 0 12px rgba(80, 210, 180, 0.6);
    animation: none;
  }

  .branding:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  @keyframes dotPulse {
    0%, 100% {
      opacity: 0.4;
      transform: scale(1);
      box-shadow: 0 0 6px rgba(80, 210, 180, 0.3);
    }
    50% {
      opacity: 1;
      transform: scale(1.2);
      box-shadow: 0 0 12px rgba(80, 210, 180, 0.6);
    }
  }

  .reject-msg {
    position: fixed;
    bottom: 70px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: 12px;
    color: rgba(255, 180, 120, 0.7);
    background: rgba(255, 180, 120, 0.06);
    border: 1px solid rgba(255, 180, 120, 0.12);
    border-radius: 20px;
    padding: 8px 20px;
    z-index: 40;
    animation: fadeUp 0.3s ease-out;
    white-space: nowrap;
    letter-spacing: 0.3px;
  }

  .error-msg {
    position: fixed;
    bottom: 70px;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: 12px;
    color: rgba(255, 100, 100, 0.85);
    background: rgba(255, 100, 100, 0.08);
    border: 1px solid rgba(255, 100, 100, 0.15);
    border-radius: 20px;
    padding: 10px 20px;
    z-index: 40;
    animation: fadeUp 0.3s ease-out;
    letter-spacing: 0.3px;
    max-width: 80%;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .error-message {
    font-weight: 500;
  }

  .error-hint {
    font-size: 10px;
    color: rgba(255, 100, 100, 0.6);
    font-weight: 400;
  }

  .sphere-container {
    position: relative;
    cursor: pointer;
  }

  .sphere-container:hover :global(.sphere-core:not(.mini)) {
    filter: brightness(1.08);
  }

  .sphere-container:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  .sphere-container:focus-visible :global(.sphere-core) {
    filter: brightness(1.08);
  }

  .floor-glow {
    position: absolute;
    bottom: -28px;
    left: 50%;
    transform: translateX(-50%);
    width: 120px;
    height: 36px;
    border-radius: 50%;
    filter: blur(18px);
    pointer-events: none;
    transition: all 0.8s ease;
  }

  .drag-overlay {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1.5px solid rgba(80, 200, 255, 0.2);
    pointer-events: none;
    animation: dragPulse 1.2s ease-in-out infinite;
  }

  .mini-anchor {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .mini-label {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 300;
    font-size: 9px;
    color: rgba(255, 255, 255, 0.38);
    text-align: center;
    margin-top: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .idle-label {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 17px;
    color: rgba(255, 255, 255, 0.55);
    text-align: center;
    letter-spacing: 0.5px;
    animation: fadeUp 0.5s ease-out;
  }

  .explainer {
    margin-top: 24px;
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 13px;
    line-height: 1.8;
    color: rgba(255, 255, 255, 0.35);
    text-align: center;
    animation: fadeUp 0.6s ease-out 0.1s both;
  }

  .explainer-hint {
    display: block;
    margin-top: 8px;
    font-size: 11px;
    color: rgba(80, 210, 180, 0.4);
  }

  .progress-num {
    font-family: 'Outfit', sans-serif;
    font-weight: 200;
    font-size: 48px;
    letter-spacing: -1px;
    color: rgba(255, 255, 255, 0.85);
    text-align: center;
    min-height: 58px;
    animation: fadeUp 0.4s ease-out;
    font-variant-numeric: tabular-nums;
  }

  .stage-label {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 300;
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.4);
    text-align: center;
    margin-top: 6px;
    min-height: 16px;
  }

  .complete-area {
    text-align: center;
    animation: fadeUp 0.6s ease-out;
  }

  .file-name {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 300;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.48);
    margin-bottom: 16px;
    letter-spacing: 0.3px;
  }

  .download-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 28px;
    border-radius: 40px;
    border: 1px solid rgba(80, 210, 180, 0.25);
    background: rgba(80, 210, 180, 0.06);
    color: rgba(80, 210, 180, 0.85);
    font-family: 'Outfit', sans-serif;
    font-weight: 400;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.3s ease;
    letter-spacing: 0.3px;
  }

  .download-btn:hover {
    background: rgba(80, 210, 180, 0.12);
    border-color: rgba(80, 210, 180, 0.4);
    color: rgba(80, 210, 180, 1);
  }

  .download-btn:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  .download-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .download-dropdown {
    position: relative;
    display: inline-flex;
  }

  .download-dropdown .download-btn:first-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: none;
  }

  .dropdown-toggle {
    padding: 10px 12px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left: 1px solid rgba(80, 210, 180, 0.15);
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    min-width: 160px;
    background: rgba(20, 20, 32, 0.98);
    border: 1px solid rgba(80, 210, 180, 0.2);
    border-radius: 12px;
    padding: 6px;
    z-index: 100;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .dropdown-menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    font-family: 'Outfit', sans-serif;
    font-size: 13px;
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.2s ease;
    text-align: left;
  }

  .dropdown-menu button:hover {
    background: rgba(80, 210, 180, 0.1);
    color: rgba(80, 210, 180, 0.9);
  }

  .reset-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 14px;
    padding: 6px 16px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.24);
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 12px;
    cursor: pointer;
    transition: color 0.3s ease;
    letter-spacing: 0.3px;
  }

  .reset-btn:hover {
    color: rgba(255, 255, 255, 0.4);
  }

  .reset-btn:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  .report-trigger {
    position: fixed;
    bottom: 70px;
    right: 16px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.4s ease;
    z-index: 10;
    opacity: 0;
    transform: scale(0.8);
  }

  .report-trigger.visible {
    opacity: 1;
    transform: scale(1);
    animation: reportGlow 3s ease-in-out infinite;
  }

  .report-trigger:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(80, 210, 180, 0.2);
    animation: none;
    box-shadow: 0 0 20px rgba(80, 210, 180, 0.18);
  }

  .report-trigger:hover .rt-icon {
    color: rgba(80, 210, 180, 0.55);
  }

  .report-trigger:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  .rt-icon {
    color: rgba(255, 255, 255, 0.35);
    transition: color 0.3s ease;
  }

  .report-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(4, 5, 8, 0.6);
    z-index: 20;
    animation: fadeUp 0.25s ease-out;
  }

  .report-panel {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 420px;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    background: rgba(10, 14, 24, 0.92);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 20px;
    padding: 28px;
    z-index: 30;
    animation: slideReportIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .report-panel::-webkit-scrollbar {
    width: 4px;
  }

  .report-panel::-webkit-scrollbar-track {
    background: transparent;
  }

  .report-panel::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
  }

  .report-close {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.2s ease;
    color: rgba(255, 255, 255, 0.45);
  }

  .report-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
  }

  .report-close:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  @keyframes fadeUp {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes slideReportIn {
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes dragPulse {
    0%,
    100% {
      box-shadow:
        0 0 60px rgba(80, 200, 255, 0.25),
        0 0 120px rgba(80, 200, 255, 0.1);
    }
    50% {
      box-shadow:
        0 0 80px rgba(80, 200, 255, 0.4),
        0 0 140px rgba(80, 200, 255, 0.15);
    }
  }

  @keyframes reportGlow {
    0%,
    100% {
      box-shadow:
        0 0 12px rgba(80, 210, 180, 0.12),
        0 0 28px rgba(80, 210, 180, 0.06);
    }
    50% {
      box-shadow:
        0 0 18px rgba(80, 210, 180, 0.22),
        0 0 40px rgba(80, 210, 180, 0.1);
    }
  }

  /* Status bar */
  .status-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 10px 20px;
    background: rgba(10, 10, 18, 0.88);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(12px);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    z-index: 50;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-label {
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .status-value {
    color: rgba(80, 210, 180, 0.85);
    font-weight: 500;
  }

  .status-value.warning {
    color: rgba(255, 180, 80, 0.9);
  }

  .status-value.critical {
    color: rgba(255, 100, 100, 0.9);
  }

  .status-divider {
    width: 1px;
    height: 12px;
    background: rgba(255, 255, 255, 0.15);
  }

  /* Mobile responsiveness - Tablet */
  @media (max-width: 768px) {
    .sphere-container {
      transform: scale(0.9);
    }

    .branding {
      top: 16px;
      left: 16px;
      font-size: 11px;
      letter-spacing: 1.5px;
    }

    .report-trigger {
      bottom: 70px;
      right: 12px;
      padding: 8px 14px;
      font-size: 10px;
    }

    .report-panel {
      bottom: 12px;
      right: 12px;
      left: 12px;
      width: auto;
      max-width: none;
      padding: 20px;
      border-radius: 16px;
    }

    .progress-num {
      font-size: 40px;
    }

    .idle-label {
      font-size: 15px;
    }

    .explainer {
      font-size: 12px;
      padding: 0 20px;
    }

    .status-bar {
      padding: 8px 12px;
      gap: 12px;
      font-size: 10px;
    }

    .status-item {
      gap: 6px;
    }
  }

  /* Mobile responsiveness - Small screens */
  @media (max-width: 480px) {
    .sphere-container {
      transform: scale(0.8);
    }

    .branding {
      top: 12px;
      left: 12px;
      font-size: 10px;
      letter-spacing: 1px;
    }

    .branding-dot {
      width: 5px;
      height: 5px;
    }

    .report-trigger {
      bottom: 60px;
      right: 8px;
      padding: 6px 12px;
      font-size: 9px;
      border-radius: 14px;
    }

    .report-panel {
      bottom: 8px;
      right: 8px;
      left: 8px;
      padding: 16px;
      border-radius: 14px;
      max-height: calc(100vh - 80px);
    }

    .progress-num {
      font-size: 36px;
      min-height: 44px;
    }

    .stage-label {
      font-size: 10px;
    }

    .idle-label {
      font-size: 14px;
    }

    .explainer {
      font-size: 11px;
      line-height: 1.6;
      padding: 0 16px;
    }

    .explainer-hint {
      font-size: 10px;
    }

    .download-btn {
      padding: 8px 20px;
      font-size: 13px;
    }

    .file-name {
      font-size: 11px;
    }

    .reset-link {
      font-size: 11px;
    }

    .reject-msg,
    .error-msg {
      bottom: 60px;
      font-size: 11px;
      padding: 6px 16px;
      max-width: 90%;
    }

    .error-hint {
      font-size: 9px;
    }

    .status-bar {
      padding: 6px 10px;
      gap: 8px;
      font-size: 9px;
    }

    .status-label {
      display: none;
    }

    .status-divider {
      height: 10px;
    }
  }
</style>
