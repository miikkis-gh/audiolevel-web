import { Queue, Worker, Job } from 'bullmq';
import { getRedisClient } from './redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface AudioJobData {
  jobId: string;
  inputPath: string;
  outputPath: string;
  preset: string;
  originalName: string;
}

export interface AudioJobResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
}

let audioQueue: Queue<AudioJobData, AudioJobResult> | null = null;

export function getAudioQueue(): Queue<AudioJobData, AudioJobResult> {
  if (!audioQueue) {
    const connection = getRedisClient();

    audioQueue = new Queue<AudioJobData, AudioJobResult>('audio-processing', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: {
          age: env.FILE_RETENTION_MINUTES * 60,
          count: 100,
        },
        removeOnFail: {
          age: env.FILE_RETENTION_MINUTES * 60,
        },
      },
    });

    audioQueue.on('error', (err) => {
      logger.error({ err }, 'Queue error');
    });

    logger.info('Audio processing queue initialized');
  }

  return audioQueue;
}

export async function addAudioJob(data: AudioJobData): Promise<Job<AudioJobData, AudioJobResult>> {
  const queue = getAudioQueue();
  const job = await queue.add(data.jobId, data, {
    jobId: data.jobId,
  });
  logger.info({ jobId: data.jobId }, 'Audio job added to queue');
  return job;
}

export async function getJobStatus(jobId: string) {
  const queue = getAudioQueue();
  const job = await queue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    id: job.id,
    state,
    progress,
    data: job.data,
    result: job.returnvalue,
    failedReason: job.failedReason,
  };
}

export async function closeQueue(): Promise<void> {
  if (audioQueue) {
    await audioQueue.close();
    audioQueue = null;
    logger.info('Audio queue closed');
  }
}
