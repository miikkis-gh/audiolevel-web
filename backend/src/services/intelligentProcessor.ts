/**
 * Intelligent Audio Processor
 *
 * Orchestrates the complete intelligent processing pipeline:
 * 1. Analyze input audio
 * 2. Generate processing candidates
 * 3. Execute candidates in parallel
 * 4. Evaluate and pick winner
 * 5. Convert to output format
 *
 * @module services/intelligentProcessor
 */

import { join, dirname, extname } from 'path';
import { mkdir, copyFile, unlink } from 'fs/promises';
import { env } from '../config/env';
import { createChildLogger } from '../utils/logger';
import { analyzeAudio } from './audioAnalyzer';
import { generateCandidates } from './candidateGenerator';
import {
  executeCandidates,
  cleanupCandidateFiles,
  convertToOutputFormat,
  type CandidateProcessingResult,
} from './candidateExecutor';
import { evaluateCandidates, createEvaluationConfig } from './audioEvaluator';
import type { AnalysisResult, ContentType } from '../types/analysis';
import type { ProcessingCandidate } from '../types/candidate';
import type { EvaluationResult, CandidateScore } from '../types/evaluation';

const log = createChildLogger({ service: 'intelligentProcessor' });

/**
 * Result of intelligent processing
 */
export interface IntelligentProcessingResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration: number;

  /** Analysis results */
  analysis?: AnalysisResult;

  /** Evaluation results (includes all candidate scores) */
  evaluation?: EvaluationResult;

  /** Processing report for frontend */
  processingReport?: ProcessingReport;
}

/**
 * Processing report for frontend display
 */
export interface ProcessingReport {
  contentType: string;
  contentConfidence: number;
  problemsDetected: { problem: string; details: string }[];
  processingApplied: string[];
  candidatesTested: { name: string; score: number; isWinner: boolean }[];
  winnerReason: string;
  /** Method used for perceptual quality scoring ('visqol' or 'spectral_fallback') */
  qualityMethod: 'visqol' | 'spectral_fallback';
  inputMetrics: {
    lufs: number;
    lra: number;
    truePeak: number;
  };
  outputMetrics: {
    lufs: number;
    lra: number;
    truePeak: number;
  };
}

/**
 * Callbacks for progress updates
 */
export interface IntelligentProcessingCallbacks {
  onStage?: (stage: string) => void;
  onProgress?: (percent: number) => void;
}

/**
 * Run the intelligent processing pipeline
 *
 * @param inputPath - Path to input audio file
 * @param outputPath - Path for output file
 * @param callbacks - Optional progress callbacks
 * @returns Processing result with report
 */
export async function runIntelligentProcessing(
  inputPath: string,
  outputPath: string,
  callbacks?: IntelligentProcessingCallbacks
): Promise<IntelligentProcessingResult> {
  const startTime = Date.now();
  const processorLog = createChildLogger({ inputPath, outputPath });

  processorLog.info('Starting intelligent processing pipeline');

  try {
    // Create work directory for intermediate files
    const workDir = join(dirname(outputPath), '.intelligent-work', `job-${Date.now()}`);
    await mkdir(workDir, { recursive: true });

    // Stage 1: Analyze input
    callbacks?.onStage?.('Analyzing audio...');
    callbacks?.onProgress?.(5);

    const analysis = await analyzeAudio(inputPath);

    processorLog.info({
      contentType: analysis.contentType.type,
      confidence: analysis.contentType.confidence,
      problemCount: analysis.problemDescriptions.length,
    }, 'Analysis complete');

    callbacks?.onProgress?.(15);

    // Stage 2: Generate candidates
    callbacks?.onStage?.('Generating processing strategies...');

    const { candidates, reasoning } = generateCandidates(analysis);

    processorLog.info({ candidateCount: candidates.length }, 'Candidates generated');

    callbacks?.onProgress?.(20);

    // Stage 3: Execute candidates in parallel
    callbacks?.onStage?.(`Processing ${candidates.length} approaches...`);

    const executionOptions = {
      workDir,
      sampleRate: analysis.metrics.sampleRate,
      bitDepth: analysis.metrics.bitDepth,
      onProgress: (candidateId: string, percent: number) => {
        // Map candidate progress to overall progress (20-80%)
        const baseProgress = 20;
        const progressRange = 60;
        const candidateProgress = percent / candidates.length;
        callbacks?.onProgress?.(baseProgress + Math.floor(progressRange * candidateProgress / 100));
      },
    };

    const results = await executeCandidates(inputPath, candidates, executionOptions);

    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length === 0) {
      throw new Error('All processing candidates failed');
    }

    processorLog.info({ successCount: successfulResults.length }, 'Candidates processed');

    callbacks?.onProgress?.(80);

    // Stage 4: Evaluate and pick winner
    callbacks?.onStage?.('Evaluating results...');

    const evalConfig = createEvaluationConfig(
      analysis.contentType.type,
      Math.abs(analysis.metrics.peakDb - analysis.metrics.rmsDb) // Input SNR estimate
    );

    const evaluation = await evaluateCandidates(
      candidates,
      results,
      inputPath,
      analysis.contentType.type,
      evalConfig
    );

    processorLog.info({
      winnerId: evaluation.winnerId,
      winnerName: evaluation.winnerName,
    }, 'Winner selected');

    callbacks?.onProgress?.(90);

    // Stage 5: Convert winner to output format
    callbacks?.onStage?.('Finalizing output...');

    const winnerResult = results.find(r => r.candidateId === evaluation.winnerId);
    if (!winnerResult?.outputPath) {
      throw new Error('Winner output not found');
    }

    // Convert from intermediate WAV to target format
    const outputExt = extname(outputPath).toLowerCase();
    if (outputExt === '.wav') {
      // Just copy if output is WAV
      await copyFile(winnerResult.outputPath, outputPath);
    } else {
      // Convert to target format
      const converted = await convertToOutputFormat(
        winnerResult.outputPath,
        outputPath,
        analysis.metrics.sampleRate,
        analysis.metrics.bitDepth
      );
      if (!converted) {
        throw new Error('Failed to convert to output format');
      }
    }

    // Cleanup intermediate files
    await cleanupCandidateFiles(results);
    try {
      await unlink(workDir).catch(() => {}); // Best effort cleanup
    } catch {
      // Ignore cleanup errors
    }

    callbacks?.onProgress?.(100);

    // Build processing report for frontend
    const winner = candidates.find(c => c.id === evaluation.winnerId);
    const winnerScore = evaluation.candidates.find(c => c.candidateId === evaluation.winnerId);

    const processingReport = buildProcessingReport(
      analysis,
      evaluation,
      candidates,
      winner,
      winnerScore
    );

    const duration = Date.now() - startTime;

    processorLog.info({ duration, winnerName: evaluation.winnerName }, 'Intelligent processing complete');

    return {
      success: true,
      outputPath,
      duration,
      analysis,
      evaluation,
      processingReport,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    processorLog.error({ err }, 'Intelligent processing failed');

    return {
      success: false,
      error: errorMessage,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Build the processing report for frontend display
 */
function buildProcessingReport(
  analysis: AnalysisResult,
  evaluation: EvaluationResult,
  candidates: ProcessingCandidate[],
  winner?: ProcessingCandidate,
  winnerScore?: CandidateScore
): ProcessingReport {
  return {
    contentType: analysis.contentType.type,
    contentConfidence: analysis.contentType.confidence,
    problemsDetected: analysis.problemDescriptions,
    processingApplied: winner?.filtersApplied || [],
    candidatesTested: evaluation.candidates.map(c => ({
      name: c.candidateName,
      score: Math.round(c.totalScore * 10) / 10, // One decimal place
      isWinner: c.candidateId === evaluation.winnerId,
    })),
    winnerReason: evaluation.winnerReason,
    qualityMethod: evaluation.qualityMethod,
    inputMetrics: {
      lufs: analysis.metrics.integratedLufs,
      lra: analysis.metrics.loudnessRange,
      truePeak: analysis.metrics.truePeak,
    },
    outputMetrics: winnerScore ? {
      lufs: winnerScore.metrics.integratedLufs,
      lra: winnerScore.metrics.loudnessRange,
      truePeak: winnerScore.metrics.truePeak,
    } : {
      lufs: analysis.metrics.integratedLufs,
      lra: analysis.metrics.loudnessRange,
      truePeak: analysis.metrics.truePeak,
    },
  };
}

/**
 * Check if intelligent processing should be used for a file
 *
 * Can be used to conditionally enable intelligent processing
 * based on file characteristics or user preferences.
 */
export function shouldUseIntelligentProcessing(
  _inputPath: string,
  _useIntelligent: boolean = true
): boolean {
  // For now, always use intelligent processing when enabled
  // Could add logic to skip for very short files, etc.
  return _useIntelligent;
}
