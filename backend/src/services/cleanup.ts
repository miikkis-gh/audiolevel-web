import cron from 'node-cron';
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';

let cleanupTask: cron.ScheduledTask | null = null;

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
 * Start the cleanup cron job
 * Runs every 5 minutes
 */
export function startCleanupJob(): void {
  if (cleanupTask) {
    logger.warn('Cleanup job already running');
    return;
  }

  // Run every 5 minutes
  cleanupTask = cron.schedule('*/5 * * * *', async () => {
    await runCleanup();
  });

  logger.info(
    { retentionMinutes: env.FILE_RETENTION_MINUTES },
    'File cleanup job started (runs every 5 minutes)'
  );

  // Run initial cleanup
  runCleanup();
}

/**
 * Stop the cleanup cron job
 */
export function stopCleanupJob(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
    logger.info('File cleanup job stopped');
  }
}
