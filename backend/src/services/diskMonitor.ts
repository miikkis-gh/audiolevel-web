import { statfs } from 'fs/promises';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface DiskUsage {
  total: number;
  free: number;
  used: number;
  usedPercent: number;
  available: boolean;
}

export interface DiskThresholds {
  warningPercent: number;
  criticalPercent: number;
  minFreeBytes: number;
}

const DEFAULT_THRESHOLDS: DiskThresholds = {
  warningPercent: 80,
  criticalPercent: 90,
  minFreeBytes: 500 * 1024 * 1024, // 500MB minimum
};

let lastDiskCheck: DiskUsage | null = null;
let lastCheckTime = 0;
const CHECK_CACHE_MS = 30000; // Cache disk check for 30 seconds

// Track pending upload bytes to account for concurrent uploads
let pendingUploadBytes = 0;

/**
 * Reserve disk space for an upload (call before accepting upload)
 */
export function reserveDiskSpace(bytes: number): void {
  pendingUploadBytes += bytes;
}

/**
 * Release reserved disk space (call after upload completes or fails)
 */
export function releaseDiskSpace(bytes: number): void {
  pendingUploadBytes = Math.max(0, pendingUploadBytes - bytes);
}

/**
 * Get disk usage for the uploads/outputs directory
 */
export async function getDiskUsage(path: string = env.UPLOAD_DIR): Promise<DiskUsage> {
  const now = Date.now();

  // Return cached result if recent
  if (lastDiskCheck && now - lastCheckTime < CHECK_CACHE_MS) {
    return lastDiskCheck;
  }

  try {
    const stats = await statfs(path);

    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const available = stats.bavail * stats.bsize;
    const used = total - free;
    const usedPercent = (used / total) * 100;

    lastDiskCheck = {
      total,
      free: available, // Use available (what non-root can use)
      used,
      usedPercent,
      available: true,
    };
    lastCheckTime = now;

    return lastDiskCheck;
  } catch (err) {
    logger.error({ err, path }, 'Failed to get disk usage');
    return {
      total: 0,
      free: 0,
      used: 0,
      usedPercent: 100,
      available: false,
    };
  }
}

/**
 * Check if there's enough disk space for a new upload
 */
export async function hasEnoughSpace(
  requiredBytes: number,
  thresholds: Partial<DiskThresholds> = {}
): Promise<{ allowed: boolean; reason?: string; usage: DiskUsage }> {
  const { warningPercent, criticalPercent, minFreeBytes } = {
    ...DEFAULT_THRESHOLDS,
    ...thresholds,
  };

  const usage = await getDiskUsage();

  if (!usage.available) {
    return {
      allowed: false,
      reason: 'Unable to check disk space',
      usage,
    };
  }

  // Check if we have minimum free space
  if (usage.free < minFreeBytes) {
    logger.error(
      { freeBytes: usage.free, minFreeBytes },
      'Disk space critically low'
    );
    return {
      allowed: false,
      reason: 'Server storage is full. Please try again later.',
      usage,
    };
  }

  // Check if adding this file would exceed critical threshold
  const projectedUsedPercent = ((usage.used + requiredBytes) / usage.total) * 100;
  if (projectedUsedPercent > criticalPercent) {
    logger.warn(
      { projectedUsedPercent, criticalPercent },
      'Upload would exceed critical disk threshold'
    );
    return {
      allowed: false,
      reason: 'Server storage is nearly full. Please try again later.',
      usage,
    };
  }

  // Check if we have enough space for this specific file
  // Account for processing overhead (input + output + temp = ~3x)
  // Also account for concurrent uploads that are in progress
  const estimatedRequired = requiredBytes * 3;
  const effectiveFreeSpace = usage.free - (pendingUploadBytes * 3);
  if (effectiveFreeSpace < estimatedRequired) {
    return {
      allowed: false,
      reason: 'Not enough space to process this file',
      usage,
    };
  }

  // Log warning if approaching threshold
  if (usage.usedPercent > warningPercent) {
    logger.warn(
      { usedPercent: usage.usedPercent, warningPercent },
      'Disk usage approaching warning threshold'
    );
  }

  return { allowed: true, usage };
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Get disk status for health checks
 */
export async function getDiskStatus(): Promise<{
  status: 'healthy' | 'warning' | 'critical';
  usage: DiskUsage;
  message: string;
}> {
  const usage = await getDiskUsage();

  if (!usage.available) {
    return {
      status: 'critical',
      usage,
      message: 'Unable to check disk space',
    };
  }

  if (usage.usedPercent > DEFAULT_THRESHOLDS.criticalPercent) {
    return {
      status: 'critical',
      usage,
      message: `Disk usage critical: ${usage.usedPercent.toFixed(1)}%`,
    };
  }

  if (usage.usedPercent > DEFAULT_THRESHOLDS.warningPercent) {
    return {
      status: 'warning',
      usage,
      message: `Disk usage high: ${usage.usedPercent.toFixed(1)}%`,
    };
  }

  return {
    status: 'healthy',
    usage,
    message: `Disk usage normal: ${usage.usedPercent.toFixed(1)}%`,
  };
}
