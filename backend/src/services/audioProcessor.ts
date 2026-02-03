import { spawn } from 'bun';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';
import {
  buildAnalyzeCommand,
  buildProbeCommand,
  parseLoudnessAnalysis,
  parseProbeOutput,
  type LoudnessAnalysis,
  type AudioMetadata,
} from '../utils/ffmpeg';
import {
  getResourceLimitedCommand,
  getResourceLimitEnv,
  getAdaptiveResourceLimits,
  incrementActiveProcesses,
  decrementActiveProcesses,
  DEFAULT_RESOURCE_LIMITS,
} from '../utils/resourceLimiter';
import { runMasteringProcess } from './masteringProcessor';

export interface ProcessingOptions {
  inputPath: string;
  outputPath: string;
}

export interface ProcessingResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  processingType?: 'mastering-pipeline';
  inputAnalysis?: LoudnessAnalysis;
  outputAnalysis?: LoudnessAnalysis;
  metadata?: AudioMetadata;
  filterChain?: string;
  masteringDecisions?: {
    compressionEnabled: boolean;
    saturationEnabled: boolean;
  };
}

export interface ProcessingCallbacks {
  onProgress?: (percent: number) => void;
  onStage?: (stage: string) => void;
}

/**
 * Execute a command with timeout and resource limits
 */
async function executeWithTimeout(
  command: string,
  args: string[],
  timeoutMs: number,
  onOutput?: (data: string) => void,
  useResourceLimits: boolean = false
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const log = createChildLogger({ command, args: args.slice(0, 3) });

  // Get adaptive resource limits based on system load
  const limits = useResourceLimits ? await getAdaptiveResourceLimits() : DEFAULT_RESOURCE_LIMITS;

  // Apply resource-limited wrapper (nice/ionice on Linux)
  const wrapped = useResourceLimits
    ? getResourceLimitedCommand(command, args, limits)
    : { command, args };

  // Get environment variables for resource limiting
  const resourceEnv = getResourceLimitEnv(limits);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    if (useResourceLimits) {
      incrementActiveProcesses();
    }

    const proc = spawn({
      cmd: [wrapped.command, ...wrapped.args],
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        ...resourceEnv,
      },
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill();
      if (useResourceLimits) {
        decrementActiveProcesses();
      }
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Read stdout
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          stdout += chunk;
          if (onOutput) onOutput(chunk);
        }
      } catch (e) {
        if (!killed) log.error({ err: e }, 'Error reading stdout');
      }
    })();

    // Read stderr
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          stderr += chunk;
          if (onOutput) onOutput(chunk);
        }
      } catch (e) {
        if (!killed) log.error({ err: e }, 'Error reading stderr');
      }
    })();

    // Wait for process to complete
    proc.exited.then((exitCode) => {
      clearTimeout(timeoutId);
      if (useResourceLimits) {
        decrementActiveProcesses();
      }
      if (!killed) {
        resolve({ stdout, stderr, exitCode });
      }
    }).catch((err) => {
      clearTimeout(timeoutId);
      if (useResourceLimits) {
        decrementActiveProcesses();
      }
      if (!killed) {
        reject(err);
      }
    });
  });
}

/**
 * Get audio file metadata
 */
export async function getAudioMetadata(inputPath: string): Promise<AudioMetadata | null> {
  const log = createChildLogger({ inputPath });
  const { command, args } = buildProbeCommand(inputPath);

  try {
    const { stdout, exitCode } = await executeWithTimeout(
      command,
      args,
      30000 // 30 second timeout for probe
    );

    if (exitCode !== 0) {
      log.warn({ exitCode }, 'FFprobe returned non-zero exit code');
      return null;
    }

    return parseProbeOutput(stdout);
  } catch (err) {
    log.error({ err }, 'Failed to get audio metadata');
    return null;
  }
}

/**
 * Analyze audio loudness
 */
export async function analyzeLoudness(inputPath: string): Promise<LoudnessAnalysis | null> {
  const log = createChildLogger({ inputPath });
  const { command, args } = buildAnalyzeCommand(inputPath);

  try {
    const { stderr, exitCode } = await executeWithTimeout(
      command,
      args,
      env.PROCESSING_TIMEOUT_MS
    );

    if (exitCode !== 0) {
      log.warn({ exitCode }, 'FFmpeg analysis returned non-zero exit code');
      return null;
    }

    return parseLoudnessAnalysis(stderr);
  } catch (err) {
    log.error({ err }, 'Failed to analyze loudness');
    return null;
  }
}

/**
 * Process audio file using mastering pipeline
 * Applies: highpass filter, adaptive compression, saturation, loudness normalization, limiting
 */
export async function processAudio(
  options: ProcessingOptions,
  callbacks?: ProcessingCallbacks
): Promise<ProcessingResult> {
  const log = createChildLogger({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
  });

  const startTime = Date.now();

  try {
    // Get metadata first
    callbacks?.onStage?.('Analyzing input file...');
    const metadata = await getAudioMetadata(options.inputPath);
    if (!metadata) {
      return {
        success: false,
        error: 'Failed to read audio file metadata. The file may be corrupted or unsupported.',
      };
    }

    log.info({ metadata }, 'Audio metadata retrieved');

    // Determine output format from the output path
    const outputFormat = options.outputPath.split('.').pop()?.toLowerCase() || 'wav';

    // Run mastering pipeline (single-pass)
    const masterResult = await runMasteringProcess(
      options.inputPath,
      options.outputPath,
      {
        onProgress: (percent) => {
          // Map mastering progress to 10-95%
          const mappedProgress = 10 + Math.floor((percent / 100) * 85);
          callbacks?.onProgress?.(mappedProgress);
        },
        onStage: callbacks?.onStage,
      },
      outputFormat
    );

    if (!masterResult.success) {
      return {
        success: false,
        error: masterResult.error || 'Processing failed',
        duration: Date.now() - startTime,
      };
    }

    callbacks?.onProgress?.(100);
    const duration = Date.now() - startTime;

    log.info({
      duration,
      outputFormat,
      filterChain: masterResult.filterChain,
      decisions: masterResult.decisions,
      inputLufs: masterResult.inputAnalysis?.integratedLufs,
      outputLufs: masterResult.outputAnalysis?.integratedLufs,
    }, 'Audio processing complete');

    return {
      success: true,
      outputPath: options.outputPath,
      duration,
      processingType: 'mastering-pipeline',
      masteringDecisions: masterResult.decisions,
      filterChain: masterResult.filterChain,
      inputAnalysis: masterResult.inputAnalysis ? {
        inputLufs: masterResult.inputAnalysis.integratedLufs,
        inputTruePeak: masterResult.inputAnalysis.truePeak,
        inputLoudnessRange: masterResult.inputAnalysis.lra,
      } : undefined,
      outputAnalysis: masterResult.outputAnalysis ? {
        inputLufs: masterResult.outputAnalysis.integratedLufs,
        inputTruePeak: masterResult.outputAnalysis.truePeak,
        inputLoudnessRange: masterResult.outputAnalysis.lra,
      } : undefined,
      metadata,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err }, 'Audio processing failed');

    return {
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Verify FFmpeg is available
 */
export async function verifyDependencies(): Promise<{
  ffmpeg: boolean;
  ffprobe: boolean;
}> {
  const results = {
    ffmpeg: false,
    ffprobe: false,
  };

  try {
    const ffmpegCheck = await executeWithTimeout('ffmpeg', ['-version'], 5000);
    results.ffmpeg = ffmpegCheck.exitCode === 0;
  } catch {
    results.ffmpeg = false;
  }

  try {
    const ffprobeCheck = await executeWithTimeout('ffprobe', ['-version'], 5000);
    results.ffprobe = ffprobeCheck.exitCode === 0;
  } catch {
    results.ffprobe = false;
  }

  logger.info({ dependencies: results }, 'Dependency check complete');
  return results;
}

// Keep old function name as alias for backwards compatibility
export const normalizeAudio = processAudio;
