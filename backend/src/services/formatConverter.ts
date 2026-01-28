/**
 * Format Converter - Converts mastered audio to requested output format
 */

import { spawn } from 'bun';
import { logger, createChildLogger } from '../utils/logger';
import { env } from '../config/env';

export interface ConvertOptions {
  inputPath: string;      // Mastered WAV file
  outputPath: string;     // Final output path with desired extension
  outputFormat: string;   // wav, mp3, flac, aac, ogg
}

export interface ConvertResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

/**
 * Get FFmpeg codec arguments for output format
 */
function getCodecArgs(format: string): string[] {
  switch (format.toLowerCase()) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', '320k'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'aac':
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', '256k'];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-b:a', '192k'];
    case 'wav':
    default:
      return ['-c:a', 'pcm_s24le'];  // Keep 24-bit for WAV
  }
}

/**
 * Convert audio file to target format
 */
export async function convertFormat(options: ConvertOptions): Promise<ConvertResult> {
  const log = createChildLogger({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    format: options.outputFormat
  });

  // If output is already WAV and input is WAV, just return (no conversion needed)
  if (options.outputFormat === 'wav' && options.inputPath === options.outputPath) {
    return { success: true, outputPath: options.outputPath };
  }

  const codecArgs = getCodecArgs(options.outputFormat);

  const args = [
    '-i', options.inputPath,
    ...codecArgs,
    '-y',
    options.outputPath
  ];

  log.info({ args }, 'Starting format conversion');

  return new Promise((resolve) => {
    let stderr = '';
    let killed = false;

    const proc = spawn({
      cmd: ['ffmpeg', ...args],
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill();
      resolve({ success: false, error: 'Format conversion timeout' });
    }, env.PROCESSING_TIMEOUT_MS);

    // Read stderr
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          stderr += decoder.decode(value);
        }
      } catch (e) {
        if (!killed) log.error({ err: e }, 'Error reading FFmpeg stderr');
      }
    })();

    proc.exited.then((code) => {
      clearTimeout(timeout);
      if (killed) return;

      if (code === 0) {
        log.info('Format conversion complete');
        resolve({ success: true, outputPath: options.outputPath });
      } else {
        log.error({ exitCode: code, stderr }, 'Format conversion failed');
        resolve({ success: false, error: `Conversion failed: ${stderr.slice(0, 300)}` });
      }
    }).catch((err) => {
      clearTimeout(timeout);
      if (!killed) {
        resolve({ success: false, error: err.message });
      }
    });
  });
}
