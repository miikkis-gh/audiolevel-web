import { PRESET_CONFIGS, type PresetConfig } from '../schemas/presets';
import type { Preset } from '../schemas/upload';

export interface NormalizeOptions {
  inputPath: string;
  outputPath: string;
  preset: Preset;
  outputFormat?: string;
}

export interface LoudnessAnalysis {
  inputLufs: number;
  inputTruePeak: number;
  inputLoudnessRange: number;
  outputLufs?: number;
  outputTruePeak?: number;
}

export interface FFmpegNormalizeArgs {
  command: string;
  args: string[];
}

/**
 * Build ffmpeg-normalize command arguments
 */
export function buildNormalizeCommand(options: NormalizeOptions): FFmpegNormalizeArgs {
  const config = PRESET_CONFIGS[options.preset];
  const args: string[] = [];

  // Input file
  args.push(options.inputPath);

  // Output file
  args.push('-o', options.outputPath);

  // Target loudness (LUFS)
  args.push('-t', config.targetLufs.toString());

  // True peak limit
  args.push('-tp', config.truePeak.toString());

  // Loudness range target (if specified)
  if (config.loudnessRange) {
    args.push('--loudness-range-target', config.loudnessRange.toString());
  }

  // Audio codec settings based on output format
  const ext = options.outputPath.split('.').pop()?.toLowerCase() || '';
  const codecArgs = getCodecArgs(ext);
  args.push(...codecArgs);

  // Force overwrite
  args.push('-f');

  // Progress output (for parsing)
  args.push('-pr');

  return {
    command: 'ffmpeg-normalize',
    args,
  };
}

/**
 * Get codec arguments based on output format
 */
function getCodecArgs(format: string): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', '320k'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'aac':
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', '256k'];
    case 'ogg':
      // Use bitrate instead of quality scale for ffmpeg-normalize compatibility
      return ['-c:a', 'libvorbis', '-b:a', '192k'];
    case 'wav':
    default:
      return ['-c:a', 'pcm_s16le'];
  }
}

/**
 * Build FFmpeg command for loudness analysis
 */
export function buildAnalyzeCommand(inputPath: string): FFmpegNormalizeArgs {
  return {
    command: 'ffmpeg',
    args: [
      '-i', inputPath,
      '-af', 'loudnorm=print_format=json',
      '-f', 'null',
      '-',
    ],
  };
}

/**
 * Parse loudness analysis from FFmpeg stderr output
 */
export function parseLoudnessAnalysis(stderr: string): LoudnessAnalysis | null {
  try {
    // FFmpeg loudnorm filter outputs JSON in stderr
    const jsonMatch = stderr.match(/\{[\s\S]*"input_i"[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const data = JSON.parse(jsonMatch[0]);

    return {
      inputLufs: parseFloat(data.input_i) || 0,
      inputTruePeak: parseFloat(data.input_tp) || 0,
      inputLoudnessRange: parseFloat(data.input_lra) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Parse progress from ffmpeg-normalize output
 * Returns percentage (0-100)
 */
export function parseNormalizeProgress(output: string): number {
  // ffmpeg-normalize outputs progress like: "Normalizing file 1/1... 50%"
  const progressMatch = output.match(/(\d+)%/);
  if (progressMatch) {
    return parseInt(progressMatch[1], 10);
  }

  // Also check for stage indicators
  if (output.includes('First pass')) {
    return 10;
  }
  if (output.includes('Second pass')) {
    return 50;
  }
  if (output.includes('Writing')) {
    return 90;
  }

  return 0;
}

/**
 * Get audio file duration using FFprobe
 */
export function buildDurationCommand(inputPath: string): FFmpegNormalizeArgs {
  return {
    command: 'ffprobe',
    args: [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ],
  };
}

/**
 * Get audio file metadata using FFprobe
 */
export function buildProbeCommand(inputPath: string): FFmpegNormalizeArgs {
  return {
    command: 'ffprobe',
    args: [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ],
  };
}

export interface AudioMetadata {
  duration: number;
  sampleRate: number;
  channels: number;
  bitRate: number;
  codec: string;
  format: string;
}

/**
 * Parse FFprobe JSON output
 */
export function parseProbeOutput(output: string): AudioMetadata | null {
  try {
    const data = JSON.parse(output);
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');
    const format = data.format;

    if (!audioStream || !format) {
      return null;
    }

    return {
      duration: parseFloat(format.duration) || 0,
      sampleRate: parseInt(audioStream.sample_rate, 10) || 0,
      channels: audioStream.channels || 0,
      bitRate: parseInt(format.bit_rate, 10) || 0,
      codec: audioStream.codec_name || 'unknown',
      format: format.format_name || 'unknown',
    };
  } catch {
    return null;
  }
}
