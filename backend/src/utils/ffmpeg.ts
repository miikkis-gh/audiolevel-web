export interface LoudnessAnalysis {
  inputLufs: number;
  inputTruePeak: number;
  inputLoudnessRange: number;
}

export interface FFmpegCommand {
  command: string;
  args: string[];
}

/**
 * Build FFmpeg command for loudness analysis
 */
export function buildAnalyzeCommand(inputPath: string): FFmpegCommand {
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
 * Get audio file metadata using FFprobe
 */
export function buildProbeCommand(inputPath: string): FFmpegCommand {
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
