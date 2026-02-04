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
import {
  detectAudioProfile,
  type AudioProfile,
  type ProfileDetectionResult,
  type DetectionReason,
} from './profileDetector';
import {
  runNormalizationProcess,
  runPeakNormalization,
} from './normalizationProcessor';

export interface ProcessingOptions {
  inputPath: string;
  outputPath: string;
}

export interface ProcessingResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  processingType?: 'mastering' | 'normalization' | 'peak-normalization';
  inputAnalysis?: LoudnessAnalysis;
  outputAnalysis?: LoudnessAnalysis;
  metadata?: AudioMetadata;
  filterChain?: string;
  masteringDecisions?: {
    compressionEnabled: boolean;
    saturationEnabled: boolean;
  };
  // Profile detection results
  detectedProfile?: {
    type: string;
    label: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    targetLufs: number;
    targetTruePeak: number;
    standard: string;
    reasons: DetectionReason[];
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
 * Process audio file based on detected content profile.
 *
 * Automatically detects the audio content type and applies appropriate processing:
 * - **Music** (songs, mixes): Full mastering chain with compression, saturation, and limiting
 * - **Speech** (podcast, audiobook, voiceover): Simple loudness normalization to target LUFS
 * - **SFX** (samples): Peak normalization only
 *
 * @param options - Input/output paths for processing
 * @param callbacks - Optional callbacks for progress and stage updates
 * @param filename - Original filename (helps with profile detection hints)
 * @returns Processing result with success status, analysis data, and metadata
 *
 * @example
 * ```typescript
 * const result = await processAudio(
 *   { inputPath: '/uploads/song.wav', outputPath: '/outputs/song.wav' },
 *   {
 *     onProgress: (percent) => console.log(`${percent}%`),
 *     onStage: (stage) => console.log(stage)
 *   },
 *   'my-song.wav'
 * );
 *
 * if (result.success) {
 *   console.log(`Processed in ${result.duration}ms`);
 *   console.log(`Type: ${result.processingType}`);
 * }
 * ```
 */
export async function processAudio(
  options: ProcessingOptions,
  callbacks?: ProcessingCallbacks,
  filename?: string
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

    // Detect audio profile
    callbacks?.onStage?.('Classifying content type...');
    callbacks?.onProgress?.(5);

    const detectionFilename = filename || options.inputPath.split('/').pop() || 'audio';
    const profileResult = await detectAudioProfile(options.inputPath, detectionFilename);

    if (!profileResult) {
      log.warn('Profile detection failed, defaulting to mastering pipeline');
    }

    const profile = profileResult?.profile;
    const useMasteringChain = profile?.useMasteringChain ?? true;

    log.info({
      detectedType: profile?.type ?? 'default',
      label: profile?.label ?? 'Music / Song',
      confidence: profileResult?.confidence ?? 'LOW',
      useMasteringChain,
    }, 'Profile detection complete');

    // Determine output format from the output path
    const outputFormat = options.outputPath.split('.').pop()?.toLowerCase() || 'wav';

    // Build detected profile info for result
    const detectedProfile = profileResult ? {
      type: profileResult.profile.type,
      label: profileResult.profile.label,
      confidence: profileResult.confidence,
      targetLufs: profileResult.profile.targetLufs,
      targetTruePeak: profileResult.profile.targetTruePeak,
      standard: profileResult.profile.standard,
      reasons: profileResult.reasons,
    } : undefined;

    // Route to appropriate processing path
    if (profile?.type === 'SFX_SAMPLE') {
      // SFX/Samples: Use peak normalization (LUFS doesn't apply to very short files)
      callbacks?.onStage?.('Peak normalizing audio...');

      const peakResult = await runPeakNormalization(
        options.inputPath,
        options.outputPath,
        profile.targetTruePeak,
        {
          onProgress: (percent) => {
            const mappedProgress = Math.min(100, 10 + Math.floor((percent / 100) * 85));
            callbacks?.onProgress?.(mappedProgress);
          },
          onStage: callbacks?.onStage,
        },
        outputFormat
      );

      if (!peakResult.success) {
        return {
          success: false,
          error: peakResult.error || 'Peak normalization failed',
          duration: Date.now() - startTime,
          detectedProfile,
        };
      }

      callbacks?.onProgress?.(100);
      const duration = Date.now() - startTime;

      log.info({ duration, processingType: 'peak-normalization' }, 'Peak normalization complete');

      return {
        success: true,
        outputPath: options.outputPath,
        duration,
        processingType: 'peak-normalization',
        filterChain: peakResult.filterChain,
        metadata,
        detectedProfile,
      };
    } else if (!useMasteringChain && profile) {
      // Speech content (podcast, audiobook, voiceover): Simple normalization
      callbacks?.onStage?.('Normalizing audio...');

      const normResult = await runNormalizationProcess(
        options.inputPath,
        options.outputPath,
        profile,
        {
          onProgress: (percent) => {
            const mappedProgress = Math.min(100, 10 + Math.floor((percent / 100) * 85));
            callbacks?.onProgress?.(mappedProgress);
          },
          onStage: callbacks?.onStage,
        },
        outputFormat
      );

      if (!normResult.success) {
        return {
          success: false,
          error: normResult.error || 'Normalization failed',
          duration: Date.now() - startTime,
          detectedProfile,
        };
      }

      callbacks?.onProgress?.(100);
      const duration = Date.now() - startTime;

      log.info({
        duration,
        processingType: 'normalization',
        targetLufs: profile.targetLufs,
        filterChain: normResult.filterChain,
      }, 'Normalization complete');

      return {
        success: true,
        outputPath: options.outputPath,
        duration,
        processingType: 'normalization',
        filterChain: normResult.filterChain,
        inputAnalysis: normResult.inputAnalysis ? {
          inputLufs: normResult.inputAnalysis.integratedLufs,
          inputTruePeak: normResult.inputAnalysis.truePeak,
          inputLoudnessRange: normResult.inputAnalysis.loudnessRange,
        } : undefined,
        outputAnalysis: normResult.outputAnalysis ? {
          inputLufs: normResult.outputAnalysis.integratedLufs,
          inputTruePeak: normResult.outputAnalysis.truePeak,
          inputLoudnessRange: normResult.outputAnalysis.loudnessRange,
        } : undefined,
        metadata,
        detectedProfile,
      };
    } else {
      // Music content (songs, mixes): Full mastering chain
      const masterResult = await runMasteringProcess(
        options.inputPath,
        options.outputPath,
        {
          onProgress: (percent) => {
            const mappedProgress = Math.min(100, 10 + Math.floor((percent / 100) * 85));
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
          detectedProfile,
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
      }, 'Audio mastering complete');

      return {
        success: true,
        outputPath: options.outputPath,
        duration,
        processingType: 'mastering',
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
        detectedProfile,
      };
    }
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
