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


/**
 * Result from running a shell command
 */
export interface CommandResult {
  /** Standard output from the command */
  stdout: string;
  /** Standard error from the command */
  stderr: string;
  /** Process exit code (0 = success) */
  exitCode: number;
}

/**
 * Options for running commands
 */
export interface RunCommandOptions {
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs?: number;
  /** Callback for real-time output streaming */
  onOutput?: (data: string) => void;
}

/**
 * Run a shell command with timeout and output streaming support.
 * This is the shared utility for FFmpeg/FFprobe execution across all processors.
 *
 * @param command - The command to execute (e.g., 'ffmpeg', 'ffprobe')
 * @param args - Array of command arguments
 * @param options - Optional configuration for timeout and output streaming
 * @returns Promise resolving to stdout, stderr, and exit code
 * @throws Error if the process times out
 *
 * @example
 * ```typescript
 * const result = await runCommand('ffmpeg', ['-version']);
 * console.log(result.stdout);
 * ```
 */
export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  const { timeoutMs = 300000, onOutput } = options;

  // Dynamic import to avoid circular dependencies
  const { spawn } = await import('bun');

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn({
      cmd: [command, ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill();
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
          onOutput?.(chunk);
        }
      } catch {
        // Ignore read errors on killed process
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
          onOutput?.(chunk);
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
 * Run FFmpeg with standard options.
 * Convenience wrapper around runCommand for FFmpeg execution.
 *
 * @param args - FFmpeg command arguments (without 'ffmpeg' prefix)
 * @param options - Optional timeout and output streaming configuration
 * @returns Promise resolving to command result
 *
 * @example
 * ```typescript
 * const result = await runFFmpegCommand([
 *   '-i', 'input.wav',
 *   '-af', 'loudnorm',
 *   'output.wav'
 * ]);
 * ```
 */
export async function runFFmpegCommand(
  args: string[],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  return runCommand('ffmpeg', args, options);
}

/**
 * Run FFprobe with standard options.
 * Convenience wrapper around runCommand for FFprobe execution.
 *
 * @param args - FFprobe command arguments (without 'ffprobe' prefix)
 * @param options - Optional timeout and output streaming configuration
 * @returns Promise resolving to command result
 *
 * @example
 * ```typescript
 * const result = await runFFprobeCommand([
 *   '-v', 'quiet',
 *   '-print_format', 'json',
 *   '-show_format',
 *   'input.wav'
 * ]);
 * ```
 */
export async function runFFprobeCommand(
  args: string[],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  return runCommand('ffprobe', args, options);
}
