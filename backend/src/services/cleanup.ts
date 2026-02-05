import cron from 'node-cron';
import { readdir, stat, unlink, rm } from 'fs/promises';
import { join, basename } from 'path';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';
import { getAudioQueue } from './queue';
import { postActivityReport } from './discordNotifier';

let cleanupTask: cron.ScheduledTask | null = null;
let orphanCleanupTask: cron.ScheduledTask | null = null;
let activityReportTask: cron.ScheduledTask | null = null;

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

        // Skip directories - they're handled separately
        if (stats.isDirectory()) continue;

        // Use creation time (birthtimeMs) when available, fall back to ctime then mtime
        const fileTime = stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs;
        const fileAge = now - fileTime;

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
  // Match nanoid(12) format: exactly 12 alphanumeric/underscore/dash characters
  const match = filename.match(/^([a-zA-Z0-9_-]{12})-(input|output)\./);
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
        // Use creation time when available for accurate age calculation
        const fileTime = stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs;
        const fileAge = now - fileTime;

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
 * Clean up old intelligent processing work directories
 * These are temporary directories created during candidate processing
 */
async function cleanupWorkDirectories(maxAgeMinutes: number): Promise<number> {
  const log = createChildLogger({ type: 'work-dir-cleanup' });
  const workDir = join(env.OUTPUT_DIR, '.intelligent-work');
  let deletedCount = 0;

  try {
    const entries = await readdir(workDir);
    const now = Date.now();
    const maxAgeMs = maxAgeMinutes * 60 * 1000;

    for (const entry of entries) {
      // Only process job-* directories
      if (!entry.startsWith('job-')) continue;

      const dirPath = join(workDir, entry);

      try {
        const stats = await stat(dirPath);
        if (!stats.isDirectory()) continue;

        const dirTime = stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs;
        const dirAge = now - dirTime;

        if (dirAge > maxAgeMs) {
          await rm(dirPath, { recursive: true, force: true });
          deletedCount++;
          log.info({ directory: entry, ageMinutes: Math.round(dirAge / 60000) }, 'Deleted old work directory');
        }
      } catch (err) {
        log.error({ err, directory: entry }, 'Failed to cleanup work directory');
      }
    }

    if (deletedCount > 0) {
      log.info({ deletedCount }, 'Work directory cleanup complete');
    }
  } catch (err) {
    // Work directory might not exist, which is fine
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.error({ err }, 'Failed to read work directory');
    }
  }

  return deletedCount;
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
    // Also cleanup old work directories (use same retention as files)
    await cleanupWorkDirectories(env.FILE_RETENTION_MINUTES);
  });

  // Orphan cleanup: Run every 10 minutes
  orphanCleanupTask = cron.schedule('*/10 * * * *', async () => {
    await runOrphanCleanup();
  });

  // Activity report: Run every 6 hours (at 00:00, 06:00, 12:00, 18:00)
  activityReportTask = cron.schedule('0 */6 * * *', async () => {
    await postActivityReport();
  });

  logger.info(
    { retentionMinutes: env.FILE_RETENTION_MINUTES },
    'Scheduled jobs started (cleanup: 5min, orphan: 10min, activity report: 6h)'
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
  if (activityReportTask) {
    activityReportTask.stop();
    activityReportTask = null;
  }
  logger.info('Scheduled jobs stopped');
}
