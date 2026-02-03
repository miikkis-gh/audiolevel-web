import { Queue, Worker, Job } from 'bullmq';
import { getRedisClient } from './redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface AudioJobData {
  jobId: string;
  inputPath: string;
  outputPath: string;
  originalName: string;
  fileSize?: number;
}

// Priority levels (BullMQ: lower number = higher priority)
export enum JobPriority {
  HIGH = 1,      // Small files (<5MB)
  NORMAL = 5,    // Medium files (5-25MB)
  LOW = 10,      // Large files (25-50MB)
  LOWEST = 15,   // Very large files (>50MB)
}

// Queue status thresholds
export const QUEUE_THRESHOLDS = {
  OVERLOADED: 50,      // Queue is overloaded
  WARNING: 25,         // Queue is filling up
  NORMAL: 10,          // Normal operation
};

/**
 * Calculate job priority based on file size
 * Smaller files get higher priority (lower number)
 */
export function calculatePriority(fileSize?: number): JobPriority {
  if (!fileSize) return JobPriority.NORMAL;

  const sizeMB = fileSize / (1024 * 1024);

  if (sizeMB < 5) return JobPriority.HIGH;
  if (sizeMB < 25) return JobPriority.NORMAL;
  if (sizeMB < 50) return JobPriority.LOW;
  return JobPriority.LOWEST;
}

export interface DetectedProfileInfo {
  type: string;
  label: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  targetLufs: number;
  targetTruePeak: number;
  standard: string;
  reasons: Array<{ signal: string; detail: string; weight: number }>;
}

export interface AudioJobResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  // Processing type based on detected profile
  processingType?: 'mastering' | 'normalization' | 'peak-normalization';
  masteringDecisions?: {
    compressionEnabled: boolean;
    saturationEnabled: boolean;
  };
  filterChain?: string;
  inputAnalysis?: {
    inputLufs: number;
    inputTruePeak: number;
    inputLoudnessRange: number;
  };
  outputAnalysis?: {
    inputLufs: number;
    inputTruePeak: number;
    inputLoudnessRange: number;
  };
  // Profile detection results
  detectedProfile?: DetectedProfileInfo;
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
  const priority = calculatePriority(data.fileSize);

  const job = await queue.add(data.jobId, data, {
    jobId: data.jobId,
    priority,
  });

  logger.info(
    { jobId: data.jobId, priority, fileSize: data.fileSize },
    'Audio job added to queue'
  );
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

/**
 * Get queue status for health checks and graceful degradation
 */
export interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  status: 'normal' | 'warning' | 'overloaded';
  acceptingJobs: boolean;
  estimatedWaitTime?: number; // in seconds
}

export async function getQueueStatus(): Promise<QueueStatus> {
  const queue = getAudioQueue();

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  // Determine status based on waiting count
  let status: 'normal' | 'warning' | 'overloaded' = 'normal';
  let acceptingJobs = true;

  if (waiting >= QUEUE_THRESHOLDS.OVERLOADED) {
    status = 'overloaded';
    acceptingJobs = false;
  } else if (waiting >= QUEUE_THRESHOLDS.WARNING) {
    status = 'warning';
  }

  // Estimate wait time based on average processing time (assume ~60s per job)
  const avgProcessingTime = 60; // seconds
  const estimatedWaitTime = waiting > 0 ? Math.ceil((waiting / env.MAX_CONCURRENT_JOBS) * avgProcessingTime) : 0;

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    status,
    acceptingJobs,
    estimatedWaitTime,
  };
}

/**
 * Check if queue can accept new jobs (for graceful degradation)
 */
export async function canAcceptJob(fileSize?: number): Promise<{
  allowed: boolean;
  reason?: string;
  estimatedWaitTime?: number;
}> {
  const queueStatus = await getQueueStatus();

  // If queue is overloaded, reject new jobs
  if (!queueStatus.acceptingJobs) {
    logger.warn(
      { waiting: queueStatus.waiting },
      'Queue overloaded, rejecting job'
    );
    return {
      allowed: false,
      reason: 'Server is currently busy. Please try again in a few minutes.',
      estimatedWaitTime: queueStatus.estimatedWaitTime,
    };
  }

  // During warning state, only accept smaller files
  if (queueStatus.status === 'warning' && fileSize) {
    const priority = calculatePriority(fileSize);
    if (priority >= JobPriority.LOW) {
      logger.warn(
        { waiting: queueStatus.waiting, fileSize },
        'Queue busy, rejecting large file'
      );
      return {
        allowed: false,
        reason: 'Server is busy. Please try uploading a smaller file or wait a few minutes.',
        estimatedWaitTime: queueStatus.estimatedWaitTime,
      };
    }
  }

  return {
    allowed: true,
    estimatedWaitTime: queueStatus.estimatedWaitTime,
  };
}

/**
 * Pause queue processing (for maintenance/emergency)
 */
export async function pauseQueue(): Promise<void> {
  const queue = getAudioQueue();
  await queue.pause();
  logger.info('Queue paused');
}

/**
 * Resume queue processing
 */
export async function resumeQueue(): Promise<void> {
  const queue = getAudioQueue();
  await queue.resume();
  logger.info('Queue resumed');
}

/**
 * Get queue health for monitoring
 */
export async function getQueueHealth(): Promise<{
  healthy: boolean;
  issues: string[];
  metrics: QueueStatus;
}> {
  const status = await getQueueStatus();
  const issues: string[] = [];

  if (status.status === 'overloaded') {
    issues.push(`Queue overloaded with ${status.waiting} waiting jobs`);
  }

  if (status.failed > 10) {
    issues.push(`High failure rate: ${status.failed} failed jobs`);
  }

  if (status.delayed > 20) {
    issues.push(`Many delayed jobs: ${status.delayed}`);
  }

  return {
    healthy: issues.length === 0,
    issues,
    metrics: status,
  };
}
