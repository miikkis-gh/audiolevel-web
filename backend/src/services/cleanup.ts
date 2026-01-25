import cron from 'node-cron';
import { readdir, stat, unlink } from 'fs/promises';
import { join, basename } from 'path';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';
import { getAudioQueue } from './queue';

let cleanupTask: cron.ScheduledTask | null = null;
let orphanCleanupTask: cron.ScheduledTask | null = null;

// Minimum age before a file is considered potentially orphaned (5 minutes)
const ORPHAN_MIN_AGE_MS = 5 * 60 * 1000;

/**
 * Clean up old files in a directory
 */
async function cleanupDirectory(dirPath: string, maxAgeMinutes: number): Promise<number> {
  const log = createChildLogger({ directory: dirPath });
  let deletedCount = 0;

  try {
    const files = await readdir(dirPath);
    const now = Date.now();
    const maxAgeMs = maxAgeMinutes * 60 * 1000;

    for (const file of files) {
      // Skip .gitkeep files
      if (file === '.gitkeep') continue;

      const filePath = join(dirPath, file);

      try {
        const stats = await stat(filePath);
        const fileAge = now - stats.mtimeMs;

        if (fileAge > maxAgeMs) {
          await unlink(filePath);
          deletedCount++;
          log.debug({ file, ageMinutes: Math.round(fileAge / 60000) }, 'Deleted old file');
        }
      } catch (err) {
        log.error({ err, file }, 'Failed to process file during cleanup');
      }
    }

    if (deletedCount > 0) {
      log.info({ deletedCount }, 'Cleanup complete');
    }
  } catch (err) {
    log.error({ err }, 'Failed to read directory for cleanup');
  }

  return deletedCount;
}

/**
 * Run cleanup for all directories
 */
export async function runCleanup(): Promise<{ uploads: number; outputs: number }> {
  const results = {
    uploads: await cleanupDirectory(env.UPLOAD_DIR, env.FILE_RETENTION_MINUTES),
    outputs: await cleanupDirectory(env.OUTPUT_DIR, env.FILE_RETENTION_MINUTES),
  };

  if (results.uploads > 0 || results.outputs > 0) {
    logger.info(results, 'File cleanup completed');
  }

  return results;
}

/**
 * Extract job ID from filename
 * Filenames follow pattern: {jobId}-input.{ext} or {jobId}-output.{ext}
 */
function extractJobIdFromFilename(filename: string): string | null {
  const match = filename.match(/^([a-zA-Z0-9_-]+)-(input|output)\./);
  return match ? match[1] : null;
}

/**
 * Check if a job exists in the queue
 */
async function jobExists(jobId: string): Promise<boolean> {
  try {
    const queue = getAudioQueue();
    const job = await queue.getJob(jobId);
    return job !== null;
  } catch {
    // If queue is not available, assume job exists to be safe
    return true;
  }
}

/**
 * Clean up orphaned files (files without corresponding jobs in queue)
 * These are files that may have been uploaded but the job was never created,
 * or files left behind after job data was removed from Redis
 */
async function cleanupOrphanedFiles(dirPath: string): Promise<number> {
  const log = createChildLogger({ directory: dirPath, type: 'orphan-cleanup' });
  let deletedCount = 0;

  try {
    const files = await readdir(dirPath);
    const now = Date.now();

    for (const file of files) {
      // Skip .gitkeep files
      if (file === '.gitkeep') continue;

      const filePath = join(dirPath, file);
      const jobId = extractJobIdFromFilename(file);

      // Skip files we can't parse
      if (!jobId) continue;

      try {
        const stats = await stat(filePath);
        const fileAge = now - stats.mtimeMs;

        // Only check files older than minimum age to avoid race conditions
        if (fileAge < ORPHAN_MIN_AGE_MS) continue;

        // Check if job exists
        const exists = await jobExists(jobId);

        if (!exists) {
          await unlink(filePath);
          deletedCount++;
          log.info(
            { file, jobId, ageMinutes: Math.round(fileAge / 60000) },
            'Deleted orphaned file (no job in queue)'
          );
        }
      } catch (err) {
        log.error({ err, file }, 'Failed to process file during orphan cleanup');
      }
    }

    if (deletedCount > 0) {
      log.info({ deletedCount }, 'Orphan cleanup complete');
    }
  } catch (err) {
    log.error({ err }, 'Failed to read directory for orphan cleanup');
  }

  return deletedCount;
}

/**
 * Run orphan cleanup for all directories
 */
export async function runOrphanCleanup(): Promise<{ uploads: number; outputs: number }> {
  const results = {
    uploads: await cleanupOrphanedFiles(env.UPLOAD_DIR),
    outputs: await cleanupOrphanedFiles(env.OUTPUT_DIR),
  };

  if (results.uploads > 0 || results.outputs > 0) {
    logger.info(results, 'Orphan file cleanup completed');
  }

  return results;
}

/**
 * Get cleanup statistics
 */
export async function getCleanupStats(): Promise<{
  uploads: { count: number; totalSize: number };
  outputs: { count: number; totalSize: number };
}> {
  async function getDirectoryStats(dirPath: string) {
    try {
      const files = await readdir(dirPath);
      let totalSize = 0;
      let count = 0;

      for (const file of files) {
        if (file === '.gitkeep') continue;
        try {
          const stats = await stat(join(dirPath, file));
          totalSize += stats.size;
          count++;
        } catch {
          // Skip files we can't stat
        }
      }

      return { count, totalSize };
    } catch {
      return { count: 0, totalSize: 0 };
    }
  }

  return {
    uploads: await getDirectoryStats(env.UPLOAD_DIR),
    outputs: await getDirectoryStats(env.OUTPUT_DIR),
  };
}

/**
 * Start the cleanup cron job
 * Runs every 5 minutes
 */
export function startCleanupJob(): void {
  if (cleanupTask) {
    logger.warn('Cleanup job already running');
    return;
  }

  // Age-based cleanup: Run every 5 minutes
  cleanupTask = cron.schedule('*/5 * * * *', async () => {
    await runCleanup();
  });

  // Orphan cleanup: Run every 10 minutes
  orphanCleanupTask = cron.schedule('*/10 * * * *', async () => {
    await runOrphanCleanup();
  });

  logger.info(
    { retentionMinutes: env.FILE_RETENTION_MINUTES },
    'File cleanup jobs started (age-based: 5min, orphan: 10min)'
  );

  // Run initial cleanup
  runCleanup();
}

/**
 * Stop the cleanup cron jobs
 */
export function stopCleanupJob(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
  }
  if (orphanCleanupTask) {
    orphanCleanupTask.stop();
    orphanCleanupTask = null;
  }
  logger.info('File cleanup jobs stopped');
}
