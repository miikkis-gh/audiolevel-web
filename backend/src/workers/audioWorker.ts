import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../services/redis';
import { verifyDependencies } from '../services/audioProcessor';
import { runIntelligentProcessing } from '../services/intelligentProcessor';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';
import { emitJobProgress, emitJobComplete, emitJobError } from '../websocket/events';
import type { AudioJobData, AudioJobResult } from '../services/queue';

let audioWorker: Worker<AudioJobData, AudioJobResult> | null = null;

/**
 * Process an audio job using intelligent processing
 */
async function processAudioJob(
  job: Job<AudioJobData, AudioJobResult>
): Promise<AudioJobResult> {
  const log = createChildLogger({
    jobId: job.data.jobId,
    originalName: job.data.originalName,
  });

  log.info('Starting intelligent audio processing job');

  try {
    // Update progress
    await job.updateProgress(0);

    const result = await runIntelligentProcessing(
      job.data.inputPath,
      job.data.outputPath,
      {
        onProgress: async (percent) => {
          await job.updateProgress(percent);
        },
        onStage: (stage) => {
          log.info({ stage }, 'Processing stage');
        },
      }
    );

    if (result.success) {
      log.info(
        {
          duration: result.duration,
          contentType: result.analysis?.contentType.type,
          confidence: result.analysis?.contentType.confidence,
          problemCount: result.analysis?.problemDescriptions.length,
          winner: result.evaluation?.winnerName,
        },
        'Intelligent processing completed successfully'
      );

      // Map to job result format
      return {
        success: true,
        outputPath: result.outputPath,
        duration: result.duration,
        processingType: 'intelligent',
        inputAnalysis: result.analysis ? {
          inputLufs: result.analysis.metrics.integratedLufs,
          inputTruePeak: result.analysis.metrics.truePeak,
          inputLoudnessRange: result.analysis.metrics.loudnessRange,
        } : undefined,
        outputAnalysis: result.processingReport ? {
          inputLufs: result.processingReport.outputMetrics.lufs,
          inputTruePeak: result.processingReport.outputMetrics.truePeak,
          inputLoudnessRange: result.processingReport.outputMetrics.lra,
        } : undefined,
        detectedProfile: result.analysis ? {
          type: mapContentTypeToProfile(result.analysis.contentType.type),
          label: formatContentTypeLabel(result.analysis.contentType.type),
          confidence: mapConfidence(result.analysis.contentType.confidence),
          targetLufs: getTargetLufs(result.analysis.contentType.type),
          targetTruePeak: getTargetTruePeak(result.analysis.contentType.type),
          standard: getStandardForContentType(result.analysis.contentType.type),
          reasons: result.analysis.contentType.signals.map(s => ({
            signal: s.name,
            detail: `${s.indicates} indicator (${s.value.toFixed(2)})`,
            weight: s.weight,
          })),
        } : undefined,
        processingReport: result.processingReport ? {
          contentType: result.processingReport.contentType,
          contentConfidence: result.processingReport.contentConfidence,
          problemsDetected: result.processingReport.problemsDetected,
          processingApplied: result.processingReport.processingApplied,
          candidatesTested: result.processingReport.candidatesTested,
          winnerReason: result.processingReport.winnerReason,
        } : undefined,
      };
    } else {
      log.error({ error: result.error }, 'Intelligent processing failed');
      throw new Error(result.error || 'Unknown processing error');
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err }, 'Job processing error');

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Map content type to profile type string
 */
function mapContentTypeToProfile(contentType: string): string {
  const map: Record<string, string> = {
    'speech': 'SPEECH_PODCAST',
    'music': 'MUSIC_SONG',
    'podcast_mixed': 'SPEECH_PODCAST',
    'unknown': 'MUSIC_SONG',
  };
  return map[contentType] || 'MUSIC_SONG';
}

/**
 * Format content type as display label
 */
function formatContentTypeLabel(contentType: string): string {
  const map: Record<string, string> = {
    'speech': 'Podcast / Talk',
    'music': 'Music / Song',
    'podcast_mixed': 'Podcast (Mixed)',
    'unknown': 'Unknown',
  };
  return map[contentType] || 'Unknown';
}

/**
 * Map confidence score to HIGH/MEDIUM/LOW
 */
function mapConfidence(confidence: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (confidence >= 0.7) return 'HIGH';
  if (confidence >= 0.5) return 'MEDIUM';
  return 'LOW';
}

/**
 * Get standard description for content type
 */
function getStandardForContentType(contentType: string): string {
  const map: Record<string, string> = {
    'speech': 'Podcast (Spotify / Apple compatible)',
    'music': 'Streaming (Spotify / Apple Music / YouTube)',
    'podcast_mixed': 'Podcast (Spotify / Apple compatible)',
    'unknown': 'Streaming (Spotify / Apple Music / YouTube)',
  };
  return map[contentType] || 'Streaming';
}

/**
 * Get target LUFS for content type
 * Speech/podcast: -16 LUFS, Music/unknown: -14 LUFS
 */
function getTargetLufs(contentType: string): number {
  const speechTypes = ['speech', 'podcast_mixed'];
  return speechTypes.includes(contentType) ? -16 : -14;
}

/**
 * Get target true peak for content type
 * Speech/podcast: -1.5 dBTP, Music/unknown: -1 dBTP
 */
function getTargetTruePeak(contentType: string): number {
  const speechTypes = ['speech', 'podcast_mixed'];
  return speechTypes.includes(contentType) ? -1.5 : -1;
}

/**
 * Start the audio processing worker
 */
export async function startAudioWorker(): Promise<Worker<AudioJobData, AudioJobResult>> {
  if (audioWorker) {
    logger.warn('Audio worker already running');
    return audioWorker;
  }

  // Verify dependencies first
  const deps = await verifyDependencies();
  if (!deps.ffmpeg || !deps.ffprobe) {
    logger.error('FFmpeg or FFprobe not found. Audio processing will fail.');
  }

  const connection = getRedisClient();

  audioWorker = new Worker<AudioJobData, AudioJobResult>(
    'audio-processing',
    processAudioJob,
    {
      connection,
      concurrency: env.MAX_CONCURRENT_JOBS,
      limiter: {
        max: env.MAX_CONCURRENT_JOBS,
        duration: 1000,
      },
      removeOnComplete: {
        age: env.FILE_RETENTION_MINUTES * 60,
        count: 100,
      },
      removeOnFail: {
        age: env.FILE_RETENTION_MINUTES * 60,
      },
    }
  );

  audioWorker.on('completed', (job, result) => {
    logger.info(
      {
        jobId: job.data.jobId,
        success: result.success,
        duration: result.duration,
        processingType: result.processingType,
      },
      'Job completed'
    );

    // Emit WebSocket event for completion
    if (result.success && result.outputPath) {
      emitJobComplete(job.data.jobId, {
        downloadUrl: `/api/upload/job/${job.data.jobId}/download`,
        duration: result.duration,
        inputLufs: result.inputAnalysis?.inputLufs,
        outputLufs: result.outputAnalysis?.inputLufs,
        processingReport: result.processingReport,
      });
    }
  });

  audioWorker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.data.jobId,
        error: err.message,
        attemptsMade: job?.attemptsMade,
      },
      'Job failed'
    );

    // Emit WebSocket event for error
    if (job) {
      emitJobError(job.data.jobId, err.message, 'PROCESSING_FAILED');
    }
  });

  audioWorker.on('progress', (job, progress) => {
    logger.debug({ jobId: job.data.jobId, progress }, 'Job progress');

    // Emit WebSocket event for progress
    const percent = typeof progress === 'number' ? progress : (progress as any).percent || 0;
    emitJobProgress(job.data.jobId, percent);
  });

  audioWorker.on('error', (err) => {
    logger.error({ err }, 'Worker error');
  });

  audioWorker.on('stalled', (jobId) => {
    logger.warn({ jobId }, 'Job stalled');
  });

  logger.info(
    { concurrency: env.MAX_CONCURRENT_JOBS },
    'Audio processing worker started'
  );

  return audioWorker;
}

/**
 * Stop the audio processing worker
 */
export async function stopAudioWorker(): Promise<void> {
  if (audioWorker) {
    await audioWorker.close();
    audioWorker = null;
    logger.info('Audio processing worker stopped');
  }
}

/**
 * Get worker status
 */
export function getWorkerStatus(): { running: boolean; concurrency: number } {
  return {
    running: audioWorker !== null,
    concurrency: env.MAX_CONCURRENT_JOBS,
  };
}
