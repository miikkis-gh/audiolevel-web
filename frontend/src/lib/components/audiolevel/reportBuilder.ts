import type { SingleReportData, BatchReportData, IntelligentProcessingReport } from './constants';
import type { JobResult } from '../../../stores/api';

/**
 * Fallback display info when no profile detection is available
 */
export const PROCESSING_FALLBACK: Record<string, { displayName: string; standard: string; target: string }> = {
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

export function formatLufs(value: number | undefined): string {
  if (value === undefined) return 'N/A';
  return `${value.toFixed(1)} LUFS`;
}

export function formatTruePeak(value: number | undefined): string {
  if (value === undefined) return 'N/A';
  return `${value.toFixed(1)} dBTP`;
}

export function formatLra(value: number | undefined): string {
  if (value === undefined) return 'N/A';
  return `${value.toFixed(1)} LU`;
}

/**
 * Build a SingleReportData from a JobResult
 */
export function buildReportFromResult(result: JobResult): SingleReportData {
  const profile = result.detectedProfile;
  const processingType = result.processingType || 'mastering';
  const report = result.processingReport;
  const fallback = PROCESSING_FALLBACK[processingType] || PROCESSING_FALLBACK.mastering;

  const displayName = profile?.label || fallback.displayName;
  const standard = profile?.standard || fallback.standard;
  const target = profile
    ? `${profile.targetLufs} LUFS / ${profile.targetTruePeak} dBTP`
    : fallback.target;
  const confidence = profile?.confidence || 'HIGH';

  const notes: string[] = [];

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

  const reasons = profile?.reasons.map(r => ({
    signal: r.signal,
    detail: r.detail,
  })) || [
    { signal: `Processing: ${processingType}`, detail: 'processing method used' },
    { signal: `Duration: ${result.duration ? `${(result.duration / 1000).toFixed(1)}s` : 'N/A'}`, detail: 'processing time' },
  ];

  const intelligentProcessing: IntelligentProcessingReport | undefined = report ? {
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

/**
 * Build a BatchReportData from a JobResult
 */
export function buildBatchReportFromResult(result: JobResult): BatchReportData {
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

/**
 * Convert a BatchReportData back to SingleReportData (for rating)
 */
export function buildReportFromBatchReport(batch: BatchReportData): SingleReportData {
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
