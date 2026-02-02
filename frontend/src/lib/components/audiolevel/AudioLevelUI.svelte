<script lang="ts">
  import ParticleSphere from './ParticleSphere.svelte';
  import {
    SINGLE_REPORT,
    OVERRIDE_TYPES,
    MAX_BATCH,
    BATCH_MOCK_POOL,
    PROFILE_COLORS,
    type Mode,
    type ParticleState,
    type SingleReportData,
    type BatchFile,
    type OverrideType,
  } from './constants';
  import { getStageLabel, getLayout, getPositions, truncName, profileCSS } from './helpers';

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

  // Non-reactive refs
  let fileInput: HTMLInputElement;
  let mergeTriggered = false;
  let batchSpeeds: number[] = [];
  let batchStarts: number[] = [];
  let rejectTimer: ReturnType<typeof setTimeout> | null = null;
  let overrideTimer: ReturnType<typeof setTimeout> | null = null;
  let dragCount = 0;

  // Single-file processing effect
  $effect(() => {
    if (mode !== 'processing') return;
    progress = 0;
    reportReady = false;
    showReport = false;

    let cancelled = false;
    let activeTimeout: ReturnType<typeof setTimeout> | null = null;
    let p = 0;

    const tick = () => {
      if (cancelled) return;
      const sp = p < 20 ? 2.2 : p < 50 ? 1.0 : p < 85 ? 1.6 : 2.5;
      p = Math.min(100, p + sp * (0.6 + Math.random() * 0.8));
      progress = Math.round(p);
      if (p >= 100) {
        activeTimeout = setTimeout(() => {
          if (cancelled) return;
          mode = 'complete';
          activeTimeout = setTimeout(() => {
            if (!cancelled) reportReady = true;
          }, 600);
        }, 400);
      } else {
        activeTimeout = setTimeout(tick, 60 + Math.random() * 80);
      }
    };
    activeTimeout = setTimeout(tick, 300);

    return () => {
      cancelled = true;
      if (activeTimeout) clearTimeout(activeTimeout);
    };
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

  // Batch processing simulation effect
  $effect(() => {
    if (mode !== 'batch') return;
    batchSpeeds = batchFiles.map(() => 0.5 + Math.random() * 1.4);
    batchStarts = batchFiles.map((_, i) => Date.now() + i * 250 + Math.random() * 400);

    const interval = setInterval(() => {
      const now = Date.now();
      if (batchFiles.every((f) => f.progress >= 100)) {
        clearInterval(interval);
        return;
      }
      batchFiles = batchFiles.map((f, i) => {
        if (f.progress >= 100) return f;
        if (now < batchStarts[i]) return f;
        const np = Math.min(100, f.progress + batchSpeeds[i] * (0.5 + Math.random() * 0.9));
        return { ...f, progress: Math.round(np), fileState: np >= 100 ? 'complete' : 'processing' };
      });
    }, 80);

    return () => clearInterval(interval);
  });

  // Batch completion → merge effect
  $effect(() => {
    if (
      mode === 'batch' &&
      !mergeTriggered &&
      batchFiles.length > 0 &&
      batchFiles.every((f) => f.progress >= 100)
    ) {
      mergeTriggered = true;
      const t = setTimeout(() => (mode = 'merging'), 800);
      return () => clearTimeout(t);
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
  function startBatch(names: string[]) {
    const files: BatchFile[] = names.map((name, i) => ({
      id: `f-${i}-${Date.now()}`,
      name,
      progress: 0,
      fileState: 'pending',
      report: BATCH_MOCK_POOL[i % BATCH_MOCK_POOL.length],
    }));
    batchFiles = files;
    mergeTriggered = false;
    reportReady = false;
    showReport = false;
    mode = 'splitting';
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
      mode = 'processing';
    } else {
      startBatch(files.map((f) => f.name));
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
      mode = 'processing';
    } else {
      startBatch(files.map((f) => f.name));
    }
    target.value = '';
  }

  function reset() {
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
    if (rejectTimer) clearTimeout(rejectTimer);
    if (overrideTimer) clearTimeout(overrideTimer);
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
        reportIndex = Math.max(0, reportIndex - 1);
        overrideOpen = false;
      }
      if (e.key === 'ArrowRight') {
        reportIndex = Math.min(batchFiles.length - 1, reportIndex + 1);
        overrideOpen = false;
      }
    }
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
  let currentBatchReport = $derived(currentBatchFile?.report);
  let batchProfileCSS = $derived(currentBatchReport ? profileCSS(currentBatchReport.type) : null);
  let singleProfileCSS = $derived(profileCSS(singleReport.detectedAs));

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
  ondrop={handleDrop}
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
>
  <input
    bind:this={fileInput}
    type="file"
    accept="audio/*"
    multiple
    style="display: none"
    onchange={handleFileInput}
  />

  <div class="branding">AudioLevel</div>

  {#if rejectMsg}
    <div class="reject-msg">{rejectMsg}</div>
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
        <button class="download-btn">
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
        <div class="file-name">{batchFiles.length} files processed</div>
        <button class="download-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download All
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
    <div class="report-panel" role="dialog" aria-label="Analysis report" onkeydown={handleReportKeyDown}>
      <button
        class="report-close"
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

      {#if mode === 'batch-complete' && currentBatchFile && currentBatchReport && batchProfileCSS}
        <div class="report-header">Analysis Report</div>

        <div class="report-nav">
          <button
            class="report-nav-btn"
            disabled={reportIndex === 0}
            onclick={() => {
              reportIndex = Math.max(0, reportIndex - 1);
              overrideOpen = false;
            }}
            aria-label="Previous file"
          >
            &lt;
          </button>
          <div class="report-nav-info">
            <div class="report-nav-filename">{currentBatchFile.name}</div>
            <div class="report-nav-counter">{reportIndex + 1} / {batchFiles.length}</div>
          </div>
          <button
            class="report-nav-btn"
            disabled={reportIndex === batchFiles.length - 1}
            onclick={() => {
              reportIndex = Math.min(batchFiles.length - 1, reportIndex + 1);
              overrideOpen = false;
            }}
            aria-label="Next file"
          >
            &gt;
          </button>
        </div>

        <div class="report-classification">
          <span
            class="report-type"
            style="color: {batchProfileCSS.badge.color}; background: {batchProfileCSS.badge
              .background}; {batchProfileCSS.badge.border}"
          >
            {currentBatchReport.type}
          </span>
          <span class="report-confidence" style="color: {batchProfileCSS.conf.color}">
            {currentBatchReport.conf}
          </span>
        </div>

        {#if reprocessing}
          <div class="reprocessing-indicator">
            <span class="reprocessing-dot"></span>
            Reprocessing...
          </div>
        {:else}
          <div class="override-row">
            <button class="override-btn" onclick={() => (overrideOpen = !overrideOpen)}>
              {overrideOpen ? 'Cancel' : 'Wrong detection? Override →'}
            </button>
          </div>
        {/if}

        {#if overrideOpen && !reprocessing}
          <div class="override-picker">
            <div class="override-picker-label">Reprocess as</div>
            {#each OVERRIDE_TYPES as ot (ot.key)}
              {@const optPC = PROFILE_COLORS[ot.label] || [80, 210, 180]}
              {@const isCurrent = ot.label === currentBatchReport.type}
              <button
                class="override-option"
                class:current={isCurrent}
                style={isCurrent
                  ? `border-color: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.15); background: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.04)`
                  : ''}
                onclick={() => !isCurrent && handleOverride(ot)}
                disabled={isCurrent}
              >
                <span
                  class="override-option-label"
                  style={isCurrent ? `color: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.7)` : ''}
                >
                  {ot.label}
                </span>
                <span class="override-option-target">{ot.target}</span>
              </button>
            {/each}
          </div>
        {/if}

        <div class="report-section-title">Detection Signals</div>
        {#each currentBatchReport.reasons as reason, i (i)}
          <div class="reason-item">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              class="reason-chevron"
              style="color: {batchProfileCSS.chevron.color}"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <div>
              <span class="reason-signal">{reason.signal}</span>
              <span class="reason-detail"> — {reason.detail}</span>
            </div>
          </div>
        {/each}

        <div class="report-divider"></div>
        <div class="report-section-title">Levels</div>
        <div class="levels-grid">
          <div class="levels-label">Integrated loudness</div>
          <div class="level-before">{currentBatchReport.before.integrated}</div>
          <div class="level-arrow">→</div>
          <div class="level-after" style="color: {batchProfileCSS.after.color}">
            {currentBatchReport.after.integrated}
          </div>
          <div class="levels-label">True peak</div>
          <div class="level-before">{currentBatchReport.before.truePeak}</div>
          <div class="level-arrow">→</div>
          <div class="level-after" style="color: {batchProfileCSS.after.color}">
            {currentBatchReport.after.truePeak}
          </div>
          <div class="levels-label">Loudness range</div>
          <div class="level-before">{currentBatchReport.before.lra}</div>
          <div class="level-arrow">→</div>
          <div class="level-after" style="color: {batchProfileCSS.after.color}">
            {currentBatchReport.after.lra}
          </div>
        </div>

        <div class="report-divider"></div>
        <div class="report-section-title">Target Applied</div>
        <div class="target-line">{currentBatchReport.target}</div>
        <div class="target-standard">{currentBatchReport.standard}</div>

        <div class="report-divider"></div>
        <div class="report-section-title">Notes</div>
        {#each currentBatchReport.notes as note, i (i)}
          <div class="note-item">{note}</div>
        {/each}
      {:else}
        <!-- Single file report -->
        <div class="report-header">Analysis Report</div>
        <div class="report-classification">
          <span
            class="report-type"
            style="color: {singleProfileCSS.badge.color}; background: {singleProfileCSS.badge
              .background}; {singleProfileCSS.badge.border}"
          >
            {singleReport.detectedAs}
          </span>
          <span class="report-confidence" style="color: {singleProfileCSS.conf.color}">
            {singleReport.confidence}
          </span>
        </div>

        {#if reprocessing}
          <div class="reprocessing-indicator">
            <span class="reprocessing-dot"></span>
            Reprocessing...
          </div>
        {:else}
          <div class="override-row">
            <button class="override-btn" onclick={() => (overrideOpen = !overrideOpen)}>
              {overrideOpen ? 'Cancel' : 'Wrong detection? Override →'}
            </button>
          </div>
        {/if}

        {#if overrideOpen && !reprocessing}
          <div class="override-picker">
            <div class="override-picker-label">Reprocess as</div>
            {#each OVERRIDE_TYPES as ot (ot.key)}
              {@const optPC = PROFILE_COLORS[ot.label] || [80, 210, 180]}
              {@const isCurrent = ot.label === singleReport.detectedAs}
              <button
                class="override-option"
                class:current={isCurrent}
                style={isCurrent
                  ? `border-color: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.15); background: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.04)`
                  : ''}
                onclick={() => !isCurrent && handleOverride(ot)}
                disabled={isCurrent}
              >
                <span
                  class="override-option-label"
                  style={isCurrent ? `color: rgba(${optPC[0]},${optPC[1]},${optPC[2]},.7)` : ''}
                >
                  {ot.label}
                </span>
                <span class="override-option-target">{ot.target}</span>
              </button>
            {/each}
          </div>
        {/if}

        <div class="report-section-title">Detection Signals</div>
        {#each singleReport.reasons as reason, i (i)}
          <div class="reason-item">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              class="reason-chevron"
              style="color: {singleProfileCSS.chevron.color}"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <div>
              <span class="reason-signal">{reason.signal}</span>
              <span class="reason-detail"> — {reason.detail}</span>
            </div>
          </div>
        {/each}

        <div class="report-divider"></div>
        <div class="report-section-title">Levels</div>
        <div class="levels-grid">
          <div class="levels-label">Integrated loudness</div>
          <div class="level-before">{singleReport.before.integrated}</div>
          <div class="level-arrow">→</div>
          <div class="level-after" style="color: {singleProfileCSS.after.color}">
            {singleReport.after.integrated}
          </div>
          <div class="levels-label">True peak</div>
          <div class="level-before">{singleReport.before.truePeak}</div>
          <div class="level-arrow">→</div>
          <div class="level-after" style="color: {singleProfileCSS.after.color}">
            {singleReport.after.truePeak}
          </div>
          <div class="levels-label">Loudness range</div>
          <div class="level-before">{singleReport.before.lra}</div>
          <div class="level-arrow">→</div>
          <div class="level-after" style="color: {singleProfileCSS.after.color}">
            {singleReport.after.lra}
          </div>
        </div>

        <div class="report-divider"></div>
        <div class="report-section-title">Target Applied</div>
        <div class="target-line">{singleReport.target}</div>
        <div class="target-standard">{singleReport.standard}</div>

        <div class="report-divider"></div>
        <div class="report-section-title">Notes</div>
        {#each singleReport.notes as note, i (i)}
          <div class="note-item">{note}</div>
        {/each}
      {/if}
    </div>
  {/if}
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
    color: rgba(255, 255, 255, 0.16);
    user-select: none;
    z-index: 5;
  }

  .reject-msg {
    position: fixed;
    bottom: 28px;
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
    color: rgba(255, 255, 255, 0.24);
    text-align: center;
    margin-top: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .idle-label {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 14px;
    color: rgba(255, 255, 255, 0.22);
    text-align: center;
    letter-spacing: 0.5px;
    animation: fadeUp 0.5s ease-out;
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
    color: rgba(255, 255, 255, 0.25);
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
    color: rgba(255, 255, 255, 0.3);
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
    bottom: 24px;
    right: 24px;
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
    color: rgba(255, 255, 255, 0.2);
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
    background: rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.2s ease;
    color: rgba(255, 255, 255, 0.3);
  }

  .report-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
  }

  .report-close:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  .report-header {
    font-family: 'Outfit', sans-serif;
    font-weight: 500;
    font-size: 15px;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 4px;
  }

  .report-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .report-nav-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
    color: rgba(255, 255, 255, 0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    font-size: 14px;
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 400;
    flex-shrink: 0;
  }

  .report-nav-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.6);
  }

  .report-nav-btn:disabled {
    opacity: 0.2;
    cursor: default;
  }

  .report-nav-btn:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  .report-nav-info {
    text-align: center;
    flex: 1;
    min-width: 0;
  }

  .report-nav-filename {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 12px;
  }

  .report-nav-counter {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 300;
    font-size: 10px;
    letter-spacing: 1px;
    color: rgba(255, 255, 255, 0.26);
    margin-top: 3px;
  }

  .report-classification {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 20px 0;
  }

  .report-type {
    font-family: 'Outfit', sans-serif;
    font-weight: 400;
    font-size: 13px;
    padding: 4px 12px;
    border-radius: 20px;
  }

  .report-confidence {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 1.5px;
  }

  .override-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }

  .override-btn {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: 10px;
    letter-spacing: 0.8px;
    color: rgba(255, 255, 255, 0.2);
    background: none;
    border: none;
    cursor: pointer;
    transition: color 0.2s ease;
    padding: 0;
  }

  .override-btn:hover {
    color: rgba(255, 255, 255, 0.45);
  }

  .override-btn:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 2px;
  }

  .override-picker {
    margin-top: 10px;
    padding: 10px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
  }

  .override-picker-label {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.2);
    margin-bottom: 8px;
  }

  .override-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-radius: 10px;
    border: none;
    width: 100%;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    transition: all 0.15s ease;
    margin-bottom: 4px;
  }

  .override-option:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .override-option:focus-visible {
    outline: 2px solid rgba(80, 210, 180, 0.5);
    outline-offset: 1px;
  }

  .override-option.current {
    border: 1px solid rgba(80, 210, 180, 0.15);
    background: rgba(80, 210, 180, 0.04);
  }

  .override-option-label {
    font-family: 'Outfit', sans-serif;
    font-weight: 400;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.5);
  }

  .override-option.current .override-option-label {
    color: rgba(80, 210, 180, 0.7);
  }

  .override-option-target {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 300;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.24);
  }

  .reprocessing-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 300;
    font-size: 10px;
    letter-spacing: 0.8px;
    color: rgba(80, 210, 180, 0.5);
  }

  .reprocessing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(80, 210, 180, 0.5);
    animation: spinDot 1s ease-in-out infinite;
  }

  .report-section-title {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 1.8px;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.2);
    margin-bottom: 10px;
    margin-top: 20px;
  }

  .report-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.04);
    margin: 16px 0;
  }

  .reason-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 8px;
    font-family: 'Outfit', sans-serif;
    font-size: 13px;
    line-height: 1.45;
  }

  .reason-signal {
    color: rgba(255, 255, 255, 0.6);
  }

  .reason-detail {
    color: rgba(255, 255, 255, 0.25);
    margin-left: 2px;
  }

  .reason-chevron {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .levels-grid {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px 16px;
    align-items: center;
  }

  .levels-label {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 300;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.2);
    grid-column: 1 / -1;
    margin-top: 4px;
  }

  .levels-label:first-child {
    margin-top: 0;
  }

  .level-before {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.35);
    text-align: right;
  }

  .level-arrow {
    color: rgba(255, 255, 255, 0.18);
    font-size: 12px;
  }

  .level-after {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 500;
    font-size: 13px;
  }

  .target-line {
    font-family: 'IBM Plex Mono', monospace;
    font-weight: 400;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.35);
    margin-bottom: 4px;
  }

  .target-standard {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.2);
  }

  .note-item {
    font-family: 'Outfit', sans-serif;
    font-weight: 300;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.25);
    margin-bottom: 6px;
    padding-left: 12px;
    position: relative;
  }

  .note-item::before {
    content: '\00B7';
    position: absolute;
    left: 0;
    color: rgba(255, 255, 255, 0.22);
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

  @keyframes spinDot {
    0% {
      opacity: 0.2;
    }
    50% {
      opacity: 0.8;
    }
    100% {
      opacity: 0.2;
    }
  }
</style>
