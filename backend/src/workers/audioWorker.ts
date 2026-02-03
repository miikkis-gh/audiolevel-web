import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../services/redis';
import { normalizeAudio, verifyDependencies } from '../services/audioProcessor';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';
import { emitJobProgress, emitJobComplete, emitJobError } from '../websocket/events';
import type { AudioJobData, AudioJobResult } from '../services/queue';

let audioWorker: Worker<AudioJobData, AudioJobResult> | null = null;

/**
 * Process an audio normalization job
 */
async function processAudioJob(
  job: Job<AudioJobData, AudioJobResult>
): Promise<AudioJobResult> {
  const log = createChildLogger({
    jobId: job.data.jobId,
    preset: job.data.preset,
    originalName: job.data.originalName,
  });

  log.info('Starting audio processing job');

  try {
    // Update progress
    await job.updateProgress(0);

    const result = await normalizeAudio(
      {
        inputPath: job.data.inputPath,
        outputPath: job.data.outputPath,
        preset: job.data.preset as any,
      },
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
          inputLufs: result.inputAnalysis?.inputLufs,
          outputLufs: result.outputAnalysis?.inputLufs,
        },
        'Audio processing completed successfully'
      );

      return {
        success: true,
        outputPath: result.outputPath,
        duration: result.duration,
        processingType: result.processingType,
        masteringDecisions: result.masteringDecisions,
        filterChain: result.filterChain,
        inputAnalysis: result.inputAnalysis,
        outputAnalysis: result.outputAnalysis,
      };
    } else {
      log.error({ error: result.error }, 'Audio processing failed');
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
  if (!deps.ffmpegNormalize) {
    logger.error('ffmpeg-normalize not found. Audio processing will fail.');
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
      },
      'Job completed'
    );

    // Emit WebSocket event for completion
    if (result.success && result.outputPath) {
      emitJobComplete(job.data.jobId, {
        downloadUrl: `/api/upload/job/${job.data.jobId}/download`,
        duration: result.duration,
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
