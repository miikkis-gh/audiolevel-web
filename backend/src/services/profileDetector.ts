/**
 * Audio Profile Detection System
 * Analyzes audio characteristics to classify content type
 */

import { spawn } from 'bun';
import { logger, createChildLogger } from '../utils/logger';
import { env } from '../config/env';

export type AudioProfileType =
  | 'MUSIC_SONG'
  | 'MUSIC_MIX'
  | 'SPEECH_PODCAST'
  | 'SPEECH_AUDIOBOOK'
  | 'SPEECH_VO'
  | 'SFX_SAMPLE';

export interface AudioProfile {
  type: AudioProfileType;
  label: string;
  targetLufs: number;
  targetTruePeak: number;
  standard: string;
  useMasteringChain: boolean;
}

export const AUDIO_PROFILES: Record<AudioProfileType, AudioProfile> = {
  MUSIC_SONG: {
    type: 'MUSIC_SONG',
    label: 'Music / Song',
    targetLufs: -14,
    targetTruePeak: -1,
    standard: 'Streaming (Spotify / Apple Music / YouTube)',
    useMasteringChain: false,
  },
  MUSIC_MIX: {
    type: 'MUSIC_MIX',
    label: 'Music / Mix',
    targetLufs: -14,
    targetTruePeak: -1,
    standard: 'Streaming (Spotify / Apple Music / YouTube)',
    useMasteringChain: false,
  },
  SPEECH_PODCAST: {
    type: 'SPEECH_PODCAST',
    label: 'Podcast / Talk',
    targetLufs: -16,
    targetTruePeak: -1,
    standard: 'Podcast (Spotify / Apple compatible)',
    useMasteringChain: false,
  },
  SPEECH_AUDIOBOOK: {
    type: 'SPEECH_AUDIOBOOK',
    label: 'Audiobook',
    targetLufs: -19,
    targetTruePeak: -1,
    standard: 'Audiobook (ACX / Audible compatible)',
    useMasteringChain: false,
  },
  SPEECH_VO: {
    type: 'SPEECH_VO',
    label: 'Voiceover',
    targetLufs: -16,
    targetTruePeak: -1,
    standard: 'Voiceover / Broadcast',
    useMasteringChain: false,
  },
  SFX_SAMPLE: {
    type: 'SFX_SAMPLE',
    label: 'SFX / Sample',
    targetLufs: -14, // Will use peak normalization instead
    targetTruePeak: -1,
    standard: 'SFX / Sample library',
    useMasteringChain: false,
  },
};

export interface ProfileAnalysis {
  channels: number;
  sampleRate: number;
  duration: number;
  silenceRatio: number;
  integratedLufs: number;
  loudnessRange: number;
  crestFactor: number;
  truePeak: number;
}

export interface DetectionReason {
  signal: string;
  detail: string;
  weight: number;
}

export interface ProfileDetectionResult {
  profile: AudioProfile;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: DetectionReason[];
  analysis: ProfileAnalysis;
}

/**
 * Run FFmpeg/FFprobe command and capture output
 */
async function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number = 60000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn({
      cmd: [cmd, ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill();
      reject(new Error(`${cmd} timeout exceeded`));
    }, timeoutMs);

    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stdout += decoder.decode(value);
        }
      } catch {
        // Ignore read errors on killed process
      }
    })();

    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderr += decoder.decode(value);
        }
      } catch {
        // Ignore read errors on killed process
      }
    })();

    proc.exited.then((exitCode) => {
      clearTimeout(timeout);
      if (!killed) {
        resolve({ stdout, stderr, exitCode });
      }
    }).catch((err) => {
      clearTimeout(timeout);
      if (!killed) {
        reject(err);
      }
    });
  });
}

/**
 * Analyze audio file for profile detection
 */
export async function analyzeForProfile(inputPath: string): Promise<ProfileAnalysis | null> {
  const log = createChildLogger({ inputPath });

  try {
    // Get basic metadata
    const { stdout: probeOut } = await runCommand('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=channels,sample_rate:format=duration',
      '-of', 'json',
      inputPath,
    ]);

    const probeData = JSON.parse(probeOut);
    const stream = probeData.streams?.[0];
    const format = probeData.format;

    const channels = parseInt(stream?.channels || '2', 10);
    const sampleRate = parseInt(stream?.sample_rate || '44100', 10);
    const duration = parseFloat(format?.duration || '0');

    // Analyze loudness and dynamics with ebur128 and astats
    const { stderr: analysisOut } = await runCommand('ffmpeg', [
      '-i', inputPath,
      '-af', 'ebur128=peak=true,astats=metadata=1:measure_overall=1',
      '-f', 'null',
      '-',
    ], env.PROCESSING_TIMEOUT_MS);

    // Parse EBU R128 metrics from Summary section
    const summaryMatch = analysisOut.match(/Summary:[\s\S]*$/);
    const summarySection = summaryMatch ? summaryMatch[0] : '';

    const integratedMatch = summarySection.match(/I:\s*(-?[\d.]+)\s*LUFS/);
    const lraMatch = summarySection.match(/LRA:\s*(-?[\d.]+)\s*LU/);
    const truePeakMatch = summarySection.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);

    const rmsMatch = analysisOut.match(/RMS level dB:\s*(-?[\d.]+)/);
    const peakMatch = analysisOut.match(/Peak level dB:\s*(-?[\d.]+)/);

    const integratedLufs = integratedMatch ? parseFloat(integratedMatch[1]) : -23;
    const loudnessRange = lraMatch ? parseFloat(lraMatch[1]) : 6;
    const truePeak = truePeakMatch ? parseFloat(truePeakMatch[1]) : -1;
    const rmsDb = rmsMatch ? parseFloat(rmsMatch[1]) : -20;
    const peakDb = peakMatch ? parseFloat(peakMatch[1]) : -1;
    const crestFactor = Math.abs(peakDb - rmsDb);

    // Detect silence ratio using silencedetect filter
    const { stderr: silenceOut } = await runCommand('ffmpeg', [
      '-i', inputPath,
      '-af', 'silencedetect=noise=-50dB:d=0.5',
      '-f', 'null',
      '-',
    ], env.PROCESSING_TIMEOUT_MS);

    // Calculate silence ratio from silence_duration values
    const silenceDurations = silenceOut.matchAll(/silence_duration:\s*([\d.]+)/g);
    let totalSilence = 0;
    for (const match of silenceDurations) {
      totalSilence += parseFloat(match[1]);
    }
    const silenceRatio = duration > 0 ? (totalSilence / duration) * 100 : 0;

    const analysis: ProfileAnalysis = {
      channels,
      sampleRate,
      duration,
      silenceRatio,
      integratedLufs,
      loudnessRange,
      crestFactor,
      truePeak,
    };

    log.info({ analysis }, 'Profile analysis complete');
    return analysis;
  } catch (err) {
    log.error({ err }, 'Profile analysis failed');
    return null;
  }
}

/**
 * Score audio characteristics for profile detection
 */
function scoreProfile(
  analysis: ProfileAnalysis,
  filename: string
): { scores: Record<AudioProfileType, number>; reasons: Map<AudioProfileType, DetectionReason[]> } {
  const scores: Record<AudioProfileType, number> = {
    MUSIC_SONG: 0,
    MUSIC_MIX: 0,
    SPEECH_PODCAST: 0,
    SPEECH_AUDIOBOOK: 0,
    SPEECH_VO: 0,
    SFX_SAMPLE: 0,
  };

  const reasons = new Map<AudioProfileType, DetectionReason[]>();
  for (const type of Object.keys(scores) as AudioProfileType[]) {
    reasons.set(type, []);
  }

  const addReason = (type: AudioProfileType, signal: string, detail: string, weight: number) => {
    scores[type] += weight;
    reasons.get(type)!.push({ signal, detail, weight });
  };

  // Channel layout scoring
  if (analysis.channels === 1) {
    addReason('SPEECH_PODCAST', 'Mono channel layout', 'common for speech', 15);
    addReason('SPEECH_AUDIOBOOK', 'Mono channel layout', 'common for speech', 15);
    addReason('SPEECH_VO', 'Mono channel layout', 'common for voiceover', 20);
  } else if (analysis.channels === 2) {
    addReason('MUSIC_SONG', 'Stereo channel layout', 'common for music', 10);
    addReason('MUSIC_MIX', 'Stereo channel layout', 'common for music', 10);
    addReason('SFX_SAMPLE', 'Stereo channel layout', 'spatial effect', 5);
  }

  // Silence ratio scoring
  if (analysis.silenceRatio < 5) {
    addReason('MUSIC_SONG', `Silence ratio: ${analysis.silenceRatio.toFixed(1)}%`, 'very low, typical for music', 20);
    addReason('MUSIC_MIX', `Silence ratio: ${analysis.silenceRatio.toFixed(1)}%`, 'very low, continuous mix', 25);
  } else if (analysis.silenceRatio >= 15 && analysis.silenceRatio < 30) {
    addReason('SPEECH_PODCAST', `Silence ratio: ${analysis.silenceRatio.toFixed(1)}%`, 'typical for speech pauses', 15);
    addReason('SPEECH_VO', `Silence ratio: ${analysis.silenceRatio.toFixed(1)}%`, 'speech with pauses', 15);
  } else if (analysis.silenceRatio >= 30) {
    addReason('SPEECH_AUDIOBOOK', `Silence ratio: ${analysis.silenceRatio.toFixed(1)}%`, 'high, conversational pace', 20);
  }

  // Loudness range (LRA) scoring
  if (analysis.loudnessRange < 6) {
    addReason('MUSIC_SONG', `Loudness range: ${analysis.loudnessRange.toFixed(1)} LU`, 'compressed, modern music', 15);
    addReason('MUSIC_MIX', `Loudness range: ${analysis.loudnessRange.toFixed(1)} LU`, 'moderate dynamics', 10);
  } else if (analysis.loudnessRange >= 10 && analysis.loudnessRange < 15) {
    addReason('SPEECH_PODCAST', `Loudness range: ${analysis.loudnessRange.toFixed(1)} LU`, 'moderate, conversational', 15);
    addReason('SPEECH_VO', `Loudness range: ${analysis.loudnessRange.toFixed(1)} LU`, 'dynamic, uncompressed', 10);
  } else if (analysis.loudnessRange >= 15) {
    addReason('SPEECH_AUDIOBOOK', `Loudness range: ${analysis.loudnessRange.toFixed(1)} LU`, 'very dynamic, natural narration', 20);
  }

  // Crest factor scoring
  if (analysis.crestFactor < 8) {
    addReason('MUSIC_SONG', `Crest factor: ${analysis.crestFactor.toFixed(1)} dB`, 'heavily compressed/limited', 15);
  } else if (analysis.crestFactor >= 12 && analysis.crestFactor < 16) {
    addReason('SPEECH_VO', `Crest factor: ${analysis.crestFactor.toFixed(1)} dB`, 'dynamic, uncompressed', 15);
  } else if (analysis.crestFactor >= 16) {
    addReason('SFX_SAMPLE', `Crest factor: ${analysis.crestFactor.toFixed(1)} dB`, 'extremely dynamic, transient', 25);
  }

  // Duration scoring
  const minutes = analysis.duration / 60;
  if (analysis.duration < 10) {
    addReason('SFX_SAMPLE', `Duration: ${analysis.duration.toFixed(0)}s`, 'very short, typical sample', 30);
  } else if (minutes >= 2 && minutes <= 6) {
    addReason('MUSIC_SONG', `Duration: ${minutes.toFixed(1)} min`, 'typical song length', 10);
  } else if (minutes >= 30 && minutes <= 120) {
    addReason('MUSIC_MIX', `Duration: ${minutes.toFixed(1)} min`, 'long form, typical DJ set', 20);
  } else if (minutes >= 60) {
    addReason('SPEECH_AUDIOBOOK', `Duration: ${minutes.toFixed(1)} min`, 'long form, typical chapter', 25);
  }

  // Filename keyword scoring
  const lowerFilename = filename.toLowerCase();
  const keywordScoring: Array<{ keywords: string[]; type: AudioProfileType; weight: number; detail: string }> = [
    { keywords: ['episode', 'ep', 'podcast', 'interview'], type: 'SPEECH_PODCAST', weight: 25, detail: 'strong keyword match' },
    { keywords: ['chapter', 'audiobook', 'narration'], type: 'SPEECH_AUDIOBOOK', weight: 25, detail: 'strong keyword match' },
    { keywords: ['voiceover', 'vo_', '_vo', 'narr'], type: 'SPEECH_VO', weight: 20, detail: 'keyword match' },
    { keywords: ['sfx', 'sound_effect', 'sample', 'foley'], type: 'SFX_SAMPLE', weight: 20, detail: 'keyword match' },
    { keywords: ['mix', 'dj_', 'set', 'live_'], type: 'MUSIC_MIX', weight: 15, detail: 'keyword match' },
    { keywords: ['song', 'track', 'master', 'final_'], type: 'MUSIC_SONG', weight: 10, detail: 'keyword match' },
  ];

  for (const { keywords, type, weight, detail } of keywordScoring) {
    for (const keyword of keywords) {
      if (lowerFilename.includes(keyword)) {
        addReason(type, `Filename contains '${keyword}'`, detail, weight);
        break; // Only count one keyword match per category
      }
    }
  }

  return { scores, reasons };
}

/**
 * Detect audio profile from file analysis
 */
export async function detectAudioProfile(
  inputPath: string,
  filename: string
): Promise<ProfileDetectionResult | null> {
  const log = createChildLogger({ inputPath, filename });

  const analysis = await analyzeForProfile(inputPath);
  if (!analysis) {
    return null;
  }

  const { scores, reasons } = scoreProfile(analysis, filename);

  // Find the profile with the highest score
  let maxScore = 0;
  let detectedType: AudioProfileType = 'MUSIC_SONG'; // Default

  for (const [type, score] of Object.entries(scores) as [AudioProfileType, number][]) {
    if (score > maxScore) {
      maxScore = score;
      detectedType = type;
    }
  }

  // Determine confidence level
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const scoreDifference = sortedScores[0] - (sortedScores[1] || 0);

  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (scoreDifference >= 20 && maxScore >= 40) {
    confidence = 'HIGH';
  } else if (scoreDifference >= 10 || maxScore >= 30) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  const detectedReasons = reasons.get(detectedType) || [];
  const profile = AUDIO_PROFILES[detectedType];

  log.info({
    detectedType,
    confidence,
    maxScore,
    scoreDifference,
    reasonCount: detectedReasons.length,
  }, 'Profile detection complete');

  return {
    profile,
    confidence,
    reasons: detectedReasons,
    analysis,
  };
}
