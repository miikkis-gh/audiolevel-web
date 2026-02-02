<script lang="ts">
  import OverrideSelector from './OverrideSelector.svelte';
  import { type SingleReportData, type OverrideType } from './constants';
  import { profileCSS } from './helpers';

  interface Props {
    report: SingleReportData;
    reprocessing: boolean;
    overrideOpen: boolean;
    onToggleOverride: () => void;
    onOverride: (override: OverrideType) => void;
  }

  let { report, reprocessing, overrideOpen, onToggleOverride, onOverride }: Props = $props();

  let css = $derived(profileCSS(report.detectedAs));
</script>

<div class="report-header">Analysis Report</div>
<div class="report-classification">
  <span
    class="report-type"
    style="color: {css.badge.color}; background: {css.badge.background}; {css.badge.border}"
  >
    {report.detectedAs}
  </span>
  <span class="report-confidence" style="color: {css.conf.color}">
    {report.confidence}
  </span>
</div>

{#if reprocessing}
  <div class="reprocessing-indicator">
    <span class="reprocessing-dot"></span>
    Reprocessing...
  </div>
{:else}
  <div class="override-row">
    <button class="override-btn" onclick={onToggleOverride}>
      {overrideOpen ? 'Cancel' : 'Wrong detection? Override →'}
    </button>
  </div>
{/if}

{#if overrideOpen && !reprocessing}
  <OverrideSelector currentType={report.detectedAs} onSelect={onOverride} />
{/if}

<div class="report-section-title">Detection Signals</div>
{#each report.reasons as reason, i (i)}
  <div class="reason-item">
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      class="reason-chevron"
      style="color: {css.chevron.color}"
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
  <div class="level-before">{report.before.integrated}</div>
  <div class="level-arrow">→</div>
  <div class="level-after" style="color: {css.after.color}">
    {report.after.integrated}
  </div>
  <div class="levels-label">True peak</div>
  <div class="level-before">{report.before.truePeak}</div>
  <div class="level-arrow">→</div>
  <div class="level-after" style="color: {css.after.color}">
    {report.after.truePeak}
  </div>
  <div class="levels-label">Loudness range</div>
  <div class="level-before">{report.before.lra}</div>
  <div class="level-arrow">→</div>
  <div class="level-after" style="color: {css.after.color}">
    {report.after.lra}
  </div>
</div>

<div class="report-divider"></div>
<div class="report-section-title">Target Applied</div>
<div class="target-line">{report.target}</div>
<div class="target-standard">{report.standard}</div>

<div class="report-divider"></div>
<div class="report-section-title">Notes</div>
{#each report.notes as note, i (i)}
  <div class="note-item">{note}</div>
{/each}

<style>
  .report-header {
    font-family: 'Outfit', sans-serif;
    font-weight: 500;
    font-size: 15px;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 4px;
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
