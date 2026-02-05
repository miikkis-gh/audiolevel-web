/**
 * Candidate Executor
 *
 * Executes FFmpeg filter chains for processing candidates.
 * Processes internally as lossless WAV, preserves original sample rate/bit depth.
 *
 * @module services/candidateExecutor
 */

import { join, dirname, basename, extname } from 'path';
import { mkdir, unlink } from 'fs/promises';
import { env } from '../config/env';
import { createChildLogger } from '../utils/logger';
import { runCommand } from '../utils/ffmpeg';
import type { ProcessingCandidate } from '../types/candidate';

const log = createChildLogger({ service: 'candidateExecutor' });

/**
 * Result of processing a single candidate
 */
export interface CandidateProcessingResult {
  candidateId: string;
  success: boolean;
  outputPath?: string;
  error?: string;
  processingTimeMs: number;
}

/**
 * Options for candidate execution
 */
export interface ExecutionOptions {
  /** Directory for intermediate files */
  workDir: string;

  /** Original sample rate (to preserve) */
  sampleRate: number;

  /** Original bit depth (to preserve) */
  bitDepth: number;

  /** Progress callback per candidate */
  onProgress?: (candidateId: string, percent: number) => void;
}

/**
 * Execute a single candidate's filter chain
 *
 * @param inputPath - Path to input audio file
 * @param candidate - Processing candidate configuration
 * @param options - Execution options
 * @returns Processing result
 */
export async function executeCandidate(
  inputPath: string,
  candidate: ProcessingCandidate,
  options: ExecutionOptions
): Promise<CandidateProcessingResult> {
  const startTime = Date.now();
  const candidateLog = createChildLogger({
    candidateId: candidate.id,
    candidateName: candidate.name,
  });

  candidateLog.info('Starting candidate execution');

  try {
    // Ensure work directory exists
    await mkdir(options.workDir, { recursive: true });

    // Output as lossless WAV internally (preserves quality)
    const outputPath = join(options.workDir, `${candidate.id}.wav`);

    // Build FFmpeg command
    // Process as WAV to preserve quality, maintain sample rate and bit depth
    const args = [
      '-i', inputPath,
      '-af', candidate.filterChain,
      '-ar', String(options.sampleRate), // Preserve sample rate
      '-sample_fmt', getSampleFormat(options.bitDepth), // Preserve bit depth
      '-y', // Overwrite output
      outputPath,
    ];

    candidateLog.debug({ filterChain: candidate.filterChain }, 'Executing FFmpeg');

    const result = await runCommand('ffmpeg', args, {
      timeoutMs: env.PROCESSING_TIMEOUT_MS,
      onOutput: (chunk) => {
        // Parse progress from FFmpeg output if needed
        const timeMatch = chunk.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          // Could calculate percent if we knew duration
          options.onProgress?.(candidate.id, 50); // Placeholder
        }
      },
    });

    if (result.exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${result.exitCode}: ${result.stderr}`);
    }

    const processingTimeMs = Date.now() - startTime;
    candidateLog.info({ processingTimeMs, outputPath }, 'Candidate processing complete');

    return {
      candidateId: candidate.id,
      success: true,
      outputPath,
      processingTimeMs,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    candidateLog.error({ err }, 'Candidate processing failed');

    return {
      candidateId: candidate.id,
      success: false,
      error: errorMessage,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute multiple candidates in parallel
 *
 * @param inputPath - Path to input audio file
 * @param candidates - Array of processing candidates
 * @param options - Execution options
 * @returns Array of processing results
 */
export async function executeCandidates(
  inputPath: string,
  candidates: ProcessingCandidate[],
  options: ExecutionOptions
): Promise<CandidateProcessingResult[]> {
  log.info({ candidateCount: candidates.length }, 'Executing candidates in parallel');

  // Execute all candidates in parallel
  const results = await Promise.all(
    candidates.map(candidate => executeCandidate(inputPath, candidate, options))
  );

  const successCount = results.filter(r => r.success).length;
  log.info({ successCount, totalCount: candidates.length }, 'All candidates processed');

  return results;
}

/**
 * Clean up candidate output files
 *
 * @param results - Processing results containing output paths
 * @param keepWinner - Optional winner path to keep
 */
export async function cleanupCandidateFiles(
  results: CandidateProcessingResult[],
  keepWinner?: string
): Promise<void> {
  for (const result of results) {
    if (result.outputPath && result.outputPath !== keepWinner) {
      try {
        await unlink(result.outputPath);
        log.debug({ path: result.outputPath }, 'Cleaned up candidate file');
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Convert final output to target format
 *
 * @param inputPath - Path to processed WAV file
 * @param outputPath - Final output path with desired extension
 * @param sampleRate - Target sample rate
 * @param bitDepth - Target bit depth
 * @returns Success status
 */
export async function convertToOutputFormat(
  inputPath: string,
  outputPath: string,
  sampleRate: number,
  bitDepth: number
): Promise<boolean> {
  const ext = extname(outputPath).toLowerCase().slice(1);

  try {
    const args = ['-i', inputPath];

    // Add format-specific encoding settings
    switch (ext) {
      case 'mp3':
        args.push('-codec:a', 'libmp3lame', '-q:a', '2'); // High quality VBR
        break;
      case 'flac':
        args.push('-codec:a', 'flac', '-compression_level', '8');
        break;
      case 'aac':
      case 'm4a':
        args.push('-codec:a', 'aac', '-b:a', '256k');
        break;
      case 'ogg':
        args.push('-codec:a', 'libvorbis', '-q:a', '6');
        break;
      case 'opus':
        args.push('-codec:a', 'libopus', '-b:a', '128k'); // High quality Opus
        break;
      case 'wav':
        args.push('-codec:a', 'pcm_s16le'); // Standard WAV
        break;
      default:
        args.push('-codec:a', 'pcm_s16le'); // Default to WAV
    }

    args.push('-ar', String(sampleRate), '-y', outputPath);

    // Longer timeout for final conversion - 1 hour file at ~30x realtime = ~2 minutes
    // Use 5 minutes for safety margin on slow systems
    const result = await runCommand('ffmpeg', args, { timeoutMs: 300000 });
    return result.exitCode === 0;
  } catch (err) {
    log.error({ err, inputPath, outputPath }, 'Format conversion failed');
    return false;
  }
}

/**
 * Get FFmpeg sample format string for bit depth
 */
function getSampleFormat(bitDepth: number): string {
  switch (bitDepth) {
    case 8:
      return 'u8';
    case 16:
      return 's16';
    case 24:
      return 's32'; // FFmpeg uses s32 for 24-bit in WAV
    case 32:
      return 's32';
    default:
      return 's16';
  }
}
