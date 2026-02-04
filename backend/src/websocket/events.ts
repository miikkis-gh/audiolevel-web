import { broadcastToJob } from './handler';
import {
  createProgressMessage,
  createCompleteMessage,
  createErrorMessage,
  type ProcessingReportMessage,
} from './types';
import { logger } from '../utils/logger';

/**
 * Emit a progress event for a job
 */
export function emitJobProgress(jobId: string, percent: number, stage?: string): void {
  logger.debug({ jobId, percent, stage }, 'Emitting job progress');
  broadcastToJob(jobId, createProgressMessage(jobId, percent, stage));
}

/**
 * Emit a completion event for a job
 */
export function emitJobComplete(
  jobId: string,
  options: {
    downloadUrl: string;
    duration?: number;
    inputLufs?: number;
    outputLufs?: number;
    processingReport?: ProcessingReportMessage;
  }
): void {
  logger.info({ jobId, downloadUrl: options.downloadUrl, duration: options.duration }, 'Emitting job completion');
  broadcastToJob(jobId, createCompleteMessage(jobId, options.downloadUrl, options));
}

/**
 * Emit an error event for a job
 */
export function emitJobError(jobId: string, message: string, code?: string): void {
  logger.warn({ jobId, message, code }, 'Emitting job error');
  broadcastToJob(jobId, createErrorMessage(jobId, message, code));
}
