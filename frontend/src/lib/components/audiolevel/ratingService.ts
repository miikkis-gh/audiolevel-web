import { submitRating, type RatingPayload } from '../../../stores/api';
import type { SingleReportData } from './constants';

/**
 * Build a rating payload from job details and report data
 */
export function buildRatingPayload(
  jobId: string,
  rating: 'up' | 'down',
  fileName: string,
  report: SingleReportData,
): RatingPayload {
  return {
    jobId,
    rating,
    fileName,
    report: {
      contentType: report.detectedAs,
      contentConfidence: report.confidence,
      qualityMethod: report.intelligentProcessing?.qualityMethod,
      inputMetrics: {
        lufs: report.before.integrated,
        truePeak: report.before.truePeak,
        lra: report.before.lra,
      },
      outputMetrics: {
        lufs: report.after.integrated,
        truePeak: report.after.truePeak,
        lra: report.after.lra,
      },
      problemsDetected: report.intelligentProcessing?.problemsDetected.map(p => ({
        problem: p.problem,
        details: p.details,
        severity: p.severity,
      })),
      processingApplied: report.intelligentProcessing?.processingApplied,
      candidatesTested: report.intelligentProcessing?.candidatesTested,
    },
  };
}

/**
 * Submit a rating for a processed file
 */
export function submitFileRating(
  jobId: string,
  rating: 'up' | 'down',
  fileName: string,
  report: SingleReportData,
): void {
  const payload = buildRatingPayload(jobId, rating, fileName, report);
  submitRating(payload);
}
