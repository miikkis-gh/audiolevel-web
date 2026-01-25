import { env } from '../config/env';
import { logger } from './logger';

export interface ResourceLimits {
  // Maximum CPU threads FFmpeg can use
  maxThreads: number;
  // Nice value for process priority (0-19, higher = lower priority)
  niceLevel: number;
  // Maximum memory in bytes (advisory for FFmpeg)
  maxMemoryMb: number;
  // Timeout in milliseconds
  timeoutMs: number;
}

// Default resource limits for audio processing
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxThreads: 2, // Limit to 2 CPU threads
  niceLevel: 10, // Lower priority than normal processes
  maxMemoryMb: 512, // 512MB memory limit
  timeoutMs: env.PROCESSING_TIMEOUT_MS,
};

// Reduced limits for when system is under load
export const REDUCED_RESOURCE_LIMITS: ResourceLimits = {
  maxThreads: 1, // Single thread only
  niceLevel: 15, // Much lower priority
  maxMemoryMb: 256, // 256MB memory limit
  timeoutMs: env.PROCESSING_TIMEOUT_MS * 1.5, // Allow more time since slower
};

/**
 * Get FFmpeg arguments for resource limiting
 */
export function getFFmpegResourceArgs(limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS): string[] {
  return [
    // Limit number of threads
    '-threads', limits.maxThreads.toString(),
    // Disable hardware acceleration (uses more predictable resources)
    '-hwaccel', 'none',
  ];
}

/**
 * Get environment variables for resource limiting
 */
export function getResourceLimitEnv(limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS): Record<string, string> {
  return {
    // FFmpeg thread settings
    FFMPEG_THREADS: limits.maxThreads.toString(),
    // Reduce logging
    FFREPORT: 'level=32',
    // OMP thread limits (OpenMP, used by some codecs)
    OMP_NUM_THREADS: limits.maxThreads.toString(),
    OMP_THREAD_LIMIT: limits.maxThreads.toString(),
    // MKL thread limit (Intel Math Kernel Library)
    MKL_NUM_THREADS: limits.maxThreads.toString(),
  };
}

/**
 * Wrap command with nice for CPU priority (Linux only)
 */
export function wrapWithNice(
  command: string,
  args: string[],
  niceLevel: number
): { command: string; args: string[] } {
  // Only use nice on Linux
  if (process.platform !== 'linux') {
    return { command, args };
  }

  return {
    command: 'nice',
    args: ['-n', niceLevel.toString(), command, ...args],
  };
}

/**
 * Wrap command with ionice for I/O priority (Linux only)
 * Class 3 = idle (only use I/O when system is idle)
 * Class 2 = best-effort, with priority 0-7 (7 = lowest)
 */
export function wrapWithIonice(
  command: string,
  args: string[],
  ioClass: 2 | 3 = 2,
  ioPriority: number = 7
): { command: string; args: string[] } {
  // Only use ionice on Linux
  if (process.platform !== 'linux') {
    return { command, args };
  }

  const ioniceArgs = ['-c', ioClass.toString()];
  if (ioClass === 2) {
    ioniceArgs.push('-n', ioPriority.toString());
  }

  return {
    command: 'ionice',
    args: [...ioniceArgs, command, ...args],
  };
}

/**
 * Get full resource-limited command
 */
export function getResourceLimitedCommand(
  command: string,
  args: string[],
  limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS
): { command: string; args: string[] } {
  // Apply nice for CPU priority
  let wrapped = wrapWithNice(command, args, limits.niceLevel);

  // Apply ionice for I/O priority (best-effort, low priority)
  wrapped = wrapWithIonice(wrapped.command, wrapped.args, 2, 7);

  return wrapped;
}

/**
 * Check current system load to determine resource limits
 */
export async function getAdaptiveResourceLimits(): Promise<ResourceLimits> {
  try {
    // Get load average on Linux
    if (process.platform === 'linux') {
      const fs = await import('fs/promises');
      const loadAvg = await fs.readFile('/proc/loadavg', 'utf-8');
      const [load1] = loadAvg.split(' ').map(parseFloat);

      // Get number of CPUs
      const cpus = (await import('os')).cpus().length;
      const loadPerCpu = load1 / cpus;

      // If system is under high load, use reduced limits
      if (loadPerCpu > 0.7) {
        logger.debug({ load1, cpus, loadPerCpu }, 'System under load, using reduced resource limits');
        return REDUCED_RESOURCE_LIMITS;
      }
    }
  } catch {
    // Ignore errors, use default limits
  }

  return DEFAULT_RESOURCE_LIMITS;
}

/**
 * Resource usage tracking
 */
let activeProcesses = 0;
const MAX_CONCURRENT_PROCESSES = env.MAX_CONCURRENT_JOBS;

export function canStartProcess(): boolean {
  return activeProcesses < MAX_CONCURRENT_PROCESSES;
}

export function incrementActiveProcesses(): void {
  activeProcesses++;
  logger.debug({ activeProcesses, max: MAX_CONCURRENT_PROCESSES }, 'Process started');
}

export function decrementActiveProcesses(): void {
  activeProcesses = Math.max(0, activeProcesses - 1);
  logger.debug({ activeProcesses, max: MAX_CONCURRENT_PROCESSES }, 'Process finished');
}

export function getActiveProcessCount(): number {
  return activeProcesses;
}
