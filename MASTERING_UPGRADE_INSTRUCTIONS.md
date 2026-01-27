# AudioLevel: Mastering Preset Upgrade Instructions

**Objective**: Replace the current "Mastering" preset (which uses `ffmpeg-normalize`) with a custom FFmpeg-based processing chain from `auto_master_safe.sh`. The new workflow uses adaptive compression/saturation decisions, loudnorm, and aggressive limiting to achieve -9 LUFS with no clipping.

---

## Overview of Changes

The `auto_master_safe.sh` script implements a 5-stage mastering pipeline:

1. **Preflight QC** - Validates sample rate (≥44.1kHz) and channels (≤2)
2. **Analysis Pass** - Measures LUFS, LRA, true peak, RMS, and crest factor
3. **Decision Engine** - Conditionally enables compression/saturation based on dynamics
4. **Processing Pass** - Applies the dynamic filter chain via FFmpeg
5. **Post-Master QC** - Verifies output meets targets (-9 LUFS, <-0.5 dBTP)

**Key difference**: The current implementation uses `ffmpeg-normalize` CLI. The new implementation will use raw FFmpeg with a dynamic filter chain built based on audio analysis.

---

## Step-by-Step Implementation

### Step 1: Create the Mastering Processor Module

Create a new file: `backend/src/services/masteringProcessor.ts`

```typescript
/**
 * Mastering Processor - Custom FFmpeg-based mastering pipeline
 * Based on auto_master_safe.sh
 * Target: -9 LUFS, -0.5 dBTP (safe headroom)
 */

import { spawn } from 'child_process';
import { logger, createChildLogger } from '../utils/logger';
import { env } from '../config/env';

export interface MasteringAnalysis {
  integratedLufs: number;
  lra: number;           // Loudness Range
  truePeak: number;      // dBTP
  rmsDb: number;         // RMS level
  peakDb: number;        // Peak level
  crestFactor: number;   // Peak - RMS (dynamics indicator)
}

export interface MasteringResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  inputAnalysis?: MasteringAnalysis;
  outputAnalysis?: MasteringAnalysis;
  filterChain?: string;
  decisions?: {
    compressionEnabled: boolean;
    saturationEnabled: boolean;
  };
}

export interface MasteringCallbacks {
  onProgress?: (percent: number) => void;
  onStage?: (stage: string) => void;
}

/**
 * Run FFmpeg command and capture output
 */
async function runFFmpeg(
  args: string[],
  timeoutMs: number = env.PROCESSING_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', args);
    let stdout = '';
    let stderr = '';
    
    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
      reject(new Error('FFmpeg timeout exceeded'));
    }, timeoutMs);

    process.stdout.on('data', (data) => { stdout += data.toString(); });
    process.stderr.on('data', (data) => { stderr += data.toString(); });
    
    process.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    
    process.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Analyze audio loudness and dynamics using FFmpeg
 */
export async function analyzeLoudnessForMastering(inputPath: string): Promise<MasteringAnalysis | null> {
  const log = createChildLogger({ inputPath });
  
  try {
    const { stderr, exitCode } = await runFFmpeg([
      '-i', inputPath,
      '-af', 'ebur128=peak=true,astats=metadata=1:measure_overall=1',
      '-f', 'null',
      '-'
    ]);

    if (exitCode !== 0) {
      log.error({ exitCode }, 'Loudness analysis failed');
      return null;
    }

    // Parse EBU R128 metrics
    const integratedMatch = stderr.match(/I:\s*(-?[\d.]+)\s*LUFS/);
    const lraMatch = stderr.match(/LRA:\s*(-?[\d.]+)\s*LU/);
    const truePeakMatch = stderr.match(/Peak:\s*(-?[\d.]+)\s*dBFS/);
    
    // Parse astats metrics (from first channel)
    const rmsMatch = stderr.match(/RMS level dB:\s*(-?[\d.]+)/);
    const peakMatch = stderr.match(/Peak level dB:\s*(-?[\d.]+)/);

    const integratedLufs = integratedMatch ? parseFloat(integratedMatch[1]) : -23;
    const lra = lraMatch ? parseFloat(lraMatch[1]) : 6;
    const truePeak = truePeakMatch ? parseFloat(truePeakMatch[1]) : -1;
    const rmsDb = rmsMatch ? parseFloat(rmsMatch[1]) : -20;
    const peakDb = peakMatch ? parseFloat(peakMatch[1]) : -1;
    const crestFactor = Math.abs(peakDb - rmsDb);

    log.info({
      integratedLufs,
      lra,
      truePeak,
      rmsDb,
      peakDb,
      crestFactor
    }, 'Mastering analysis complete');

    return {
      integratedLufs,
      lra,
      truePeak,
      rmsDb,
      peakDb,
      crestFactor
    };
  } catch (err) {
    log.error({ err }, 'Loudness analysis error');
    return null;
  }
}

/**
 * Build the mastering filter chain based on analysis
 */
export function buildMasteringFilterChain(analysis: MasteringAnalysis): {
  filterChain: string;
  compressionEnabled: boolean;
  saturationEnabled: boolean;
} {
  const filters: string[] = [];
  let compressionEnabled = false;
  let saturationEnabled = false;

  // Always start with high-pass cleanup
  filters.push('highpass=f=25');

  // Compression decision: enable if crest factor > 10 AND LRA > 5
  if (analysis.crestFactor > 10 && analysis.lra > 5) {
    compressionEnabled = true;
    filters.push('acompressor=threshold=-18dB:ratio=2.5:attack=30:release=200:makeup=0');
  }

  // Saturation decision: enable if LUFS < -12 AND true peak < -1.5
  if (analysis.integratedLufs < -12 && analysis.truePeak < -1.5) {
    saturationEnabled = true;
    filters.push('asoftclip=type=tanh');
  }

  // Loudness normalization to -9 LUFS with conservative true peak (-1.0 dBTP)
  // This leaves headroom for the limiter
  filters.push('loudnorm=I=-9:TP=-1.0:LRA=5:print_format=summary');

  // Aggressive true-peak limiter @ -0.6 dBTP (limit=0.93 ≈ -0.63 dB)
  // This ensures no inter-sample peaks exceed -0.5 dBTP
  filters.push('alimiter=limit=0.93:attack=0.5:release=20:level=false');

  return {
    filterChain: filters.join(','),
    compressionEnabled,
    saturationEnabled
  };
}

/**
 * Run the mastering process (outputs to intermediate WAV)
 */
export async function runMasteringProcess(
  inputPath: string,
  outputPath: string,
  callbacks?: MasteringCallbacks
): Promise<MasteringResult> {
  const log = createChildLogger({ inputPath, outputPath });
  const startTime = Date.now();

  try {
    // Stage 1: Analysis
    callbacks?.onStage?.('Analyzing audio dynamics...');
    callbacks?.onProgress?.(10);
    
    const inputAnalysis = await analyzeLoudnessForMastering(inputPath);
    if (!inputAnalysis) {
      return { success: false, error: 'Failed to analyze input audio' };
    }

    log.info({ inputAnalysis }, 'Input analysis complete');

    // Stage 2: Build filter chain
    callbacks?.onStage?.('Building mastering chain...');
    callbacks?.onProgress?.(20);
    
    const { filterChain, compressionEnabled, saturationEnabled } = buildMasteringFilterChain(inputAnalysis);
    
    log.info({
      filterChain,
      compressionEnabled,
      saturationEnabled
    }, 'Filter chain built');

    // Stage 3: Process
    callbacks?.onStage?.('Applying mastering chain...');
    callbacks?.onProgress?.(30);

    const { stderr, exitCode } = await runFFmpeg([
      '-i', inputPath,
      '-af', filterChain,
      '-ar', '48000',           // Output at 48kHz
      '-c:a', 'pcm_s24le',      // 24-bit WAV intermediate
      '-y',
      outputPath
    ]);

    if (exitCode !== 0) {
      log.error({ exitCode, stderr }, 'Mastering process failed');
      return { success: false, error: `Mastering failed: ${stderr.slice(0, 500)}` };
    }

    callbacks?.onProgress?.(80);

    // Stage 4: Post-master QC
    callbacks?.onStage?.('Verifying output...');
    callbacks?.onProgress?.(90);
    
    const outputAnalysis = await analyzeLoudnessForMastering(outputPath);

    // QC checks
    if (outputAnalysis) {
      const lufsOk = outputAnalysis.integratedLufs >= -10.0 && outputAnalysis.integratedLufs <= -8.5;
      const tpOk = outputAnalysis.truePeak < -0.5;

      if (!lufsOk) {
        log.warn({ outputLufs: outputAnalysis.integratedLufs }, 'Output LUFS outside target range');
      }
      if (!tpOk) {
        log.warn({ outputTp: outputAnalysis.truePeak }, 'Output true peak exceeds limit');
      }
    }

    callbacks?.onProgress?.(100);
    const duration = Date.now() - startTime;

    log.info({ duration }, 'Mastering complete');

    return {
      success: true,
      outputPath,
      duration,
      inputAnalysis,
      outputAnalysis: outputAnalysis ?? undefined,
      filterChain,
      decisions: {
        compressionEnabled,
        saturationEnabled
      }
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown mastering error';
    log.error({ err }, 'Mastering error');
    return { success: false, error: errorMessage };
  }
}
```

---

### Step 2: Create Format Converter Module

Create a new file: `backend/src/services/formatConverter.ts`

This handles converting the mastered WAV to the user's requested output format.

```typescript
/**
 * Format Converter - Converts mastered audio to requested output format
 */

import { spawn } from 'child_process';
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
    const process = spawn('ffmpeg', args);
    let stderr = '';

    const timeout = setTimeout(() => {
      process.kill('SIGKILL');
      resolve({ success: false, error: 'Format conversion timeout' });
    }, env.PROCESSING_TIMEOUT_MS);

    process.stderr.on('data', (data) => { stderr += data.toString(); });

    process.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        log.info('Format conversion complete');
        resolve({ success: true, outputPath: options.outputPath });
      } else {
        log.error({ exitCode: code, stderr }, 'Format conversion failed');
        resolve({ success: false, error: `Conversion failed: ${stderr.slice(0, 300)}` });
      }
    });

    process.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });
  });
}
```

---

### Step 3: Update the Audio Processor

Modify `backend/src/services/audioProcessor.ts` to use the new mastering processor for the "mastering" preset.

Add imports at the top:
```typescript
import { runMasteringProcess } from './masteringProcessor';
import { convertFormat } from './formatConverter';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
```

Then modify the `normalizeAudio` function to check for mastering preset:

```typescript
export async function normalizeAudio(
  options: ProcessingOptions,
  callbacks?: ProcessingCallbacks
): Promise<ProcessingResult> {
  const log = createChildLogger({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    preset: options.preset,
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

    // === MASTERING PRESET: Use custom pipeline ===
    if (options.preset === 'mastering') {
      return await processMasteringPreset(options, callbacks, log, startTime);
    }

    // === OTHER PRESETS: Use ffmpeg-normalize as before ===
    // ... (keep existing code for other presets)
  } catch (err) {
    // ... existing error handling
  }
}

/**
 * Process mastering preset with custom FFmpeg pipeline
 */
async function processMasteringPreset(
  options: ProcessingOptions,
  callbacks: ProcessingCallbacks | undefined,
  log: ReturnType<typeof createChildLogger>,
  startTime: number
): Promise<ProcessingResult> {
  // Determine output format from the output path
  const outputFormat = options.outputPath.split('.').pop()?.toLowerCase() || 'wav';
  
  // For mastering, we always process to WAV first, then convert
  const intermediateWav = options.outputPath.replace(/\.[^.]+$/, `-mastered-${randomUUID().slice(0, 8)}.wav`);
  
  try {
    // Run mastering process
    const masterResult = await runMasteringProcess(
      options.inputPath,
      outputFormat === 'wav' ? options.outputPath : intermediateWav,
      {
        onProgress: (percent) => {
          // Map mastering progress to 10-80%
          const mappedProgress = 10 + Math.floor((percent / 100) * 70);
          callbacks?.onProgress?.(mappedProgress);
        },
        onStage: callbacks?.onStage,
      }
    );

    if (!masterResult.success) {
      return {
        success: false,
        error: masterResult.error || 'Mastering failed',
        duration: Date.now() - startTime,
      };
    }

    // If output format is not WAV, convert
    if (outputFormat !== 'wav') {
      callbacks?.onStage?.('Converting to output format...');
      callbacks?.onProgress?.(85);

      const convertResult = await convertFormat({
        inputPath: intermediateWav,
        outputPath: options.outputPath,
        outputFormat,
      });

      // Clean up intermediate WAV
      try {
        await unlink(intermediateWav);
      } catch (e) {
        log.warn({ err: e }, 'Failed to clean up intermediate file');
      }

      if (!convertResult.success) {
        return {
          success: false,
          error: convertResult.error || 'Format conversion failed',
          duration: Date.now() - startTime,
        };
      }
    }

    callbacks?.onProgress?.(100);
    const duration = Date.now() - startTime;

    log.info({
      duration,
      filterChain: masterResult.filterChain,
      decisions: masterResult.decisions,
      inputLufs: masterResult.inputAnalysis?.integratedLufs,
      outputLufs: masterResult.outputAnalysis?.integratedLufs,
    }, 'Mastering preset complete');

    return {
      success: true,
      outputPath: options.outputPath,
      duration,
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
    };
  } catch (err) {
    // Clean up intermediate file on error
    try {
      await unlink(intermediateWav);
    } catch (e) {
      // Ignore
    }
    throw err;
  }
}
```

---

### Step 4: Update Preset Configuration

Modify `backend/src/schemas/presets.ts` to add metadata for the mastering preset:

```typescript
export const PRESET_CONFIGS: Record<string, PresetConfig> = {
  // ... other presets ...
  
  mastering: {
    id: 'mastering',
    name: 'Mastering',
    description: 'Adaptive mastering with dynamic compression, saturation, and limiting. Target: -9 LUFS, -0.5 dBTP (safe)',
    targetLufs: -9,
    truePeak: -0.5,  // Updated from -0.3 to safer value
    loudnessRange: 5,
    // Note: These values are informational. The actual processing
    // uses adaptive decisions based on input analysis.
  },
};
```

---

### Step 5: Add Preflight Validation (Optional Enhancement)

Add input validation to reject problematic files early:

```typescript
// In masteringProcessor.ts

export interface PreflightResult {
  passed: boolean;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  rejectReason?: string;
}

export async function preflightCheck(inputPath: string): Promise<PreflightResult> {
  const { stdout, stderr, exitCode } = await runFFprobe([
    '-v', 'error',
    '-show_entries', 'stream=sample_rate,channels,bits_per_sample',
    '-of', 'json',
    inputPath
  ]);

  if (exitCode !== 0) {
    return { passed: false, sampleRate: 0, channels: 0, bitDepth: 0, rejectReason: 'Failed to probe file' };
  }

  try {
    const data = JSON.parse(stdout);
    const stream = data.streams?.[0];
    
    const sampleRate = parseInt(stream?.sample_rate || '0', 10);
    const channels = parseInt(stream?.channels || '0', 10);
    const bitDepth = parseInt(stream?.bits_per_sample || '0', 10);

    if (sampleRate < 44100) {
      return { passed: false, sampleRate, channels, bitDepth, rejectReason: 'Sample rate must be at least 44.1kHz' };
    }

    if (channels > 2) {
      return { passed: false, sampleRate, channels, bitDepth, rejectReason: 'Only mono or stereo audio supported' };
    }

    return { passed: true, sampleRate, channels, bitDepth };
  } catch (e) {
    return { passed: false, sampleRate: 0, channels: 0, bitDepth: 0, rejectReason: 'Failed to parse probe output' };
  }
}

async function runFFprobe(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const process = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => { stdout += data.toString(); });
    process.stderr.on('data', (data) => { stderr += data.toString(); });

    process.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    process.on('error', (err) => {
      reject(err);
    });
  });
}
```

---

## Testing Instructions

### Unit Tests

Create `backend/src/__tests__/masteringProcessor.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { buildMasteringFilterChain, type MasteringAnalysis } from '../services/masteringProcessor';

describe('Mastering Filter Chain Builder', () => {
  test('enables compression when crest factor > 10 and LRA > 5', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -18,
      lra: 8,
      truePeak: -3,
      rmsDb: -25,
      peakDb: -3,
      crestFactor: 22
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.compressionEnabled).toBe(true);
    expect(result.filterChain).toContain('acompressor');
  });

  test('skips compression when crest factor <= 10', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -14,
      lra: 3,
      truePeak: -1,
      rmsDb: -15,
      peakDb: -6,
      crestFactor: 9
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.compressionEnabled).toBe(false);
    expect(result.filterChain).not.toContain('acompressor');
  });

  test('enables saturation when quiet with headroom', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -18,
      lra: 6,
      truePeak: -3,
      rmsDb: -20,
      peakDb: -3,
      crestFactor: 17
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.saturationEnabled).toBe(true);
    expect(result.filterChain).toContain('asoftclip');
  });

  test('skips saturation when already hot', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -10,
      lra: 4,
      truePeak: -0.5,
      rmsDb: -12,
      peakDb: -1,
      crestFactor: 11
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.saturationEnabled).toBe(false);
    expect(result.filterChain).not.toContain('asoftclip');
  });

  test('always includes highpass, loudnorm, and limiter', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -14,
      lra: 4,
      truePeak: -1,
      rmsDb: -16,
      peakDb: -2,
      crestFactor: 14
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.filterChain).toContain('highpass=f=25');
    expect(result.filterChain).toContain('loudnorm=I=-9');
    expect(result.filterChain).toContain('alimiter');
  });
});
```

### Manual Testing

```bash
# Test with a dynamic track (should enable compression)
curl -X POST http://localhost:3000/upload \
  -F "file=@dynamic_track.wav" \
  -F "preset=mastering" \
  -F "outputFormat=wav"

# Test with already loud track (should skip saturation)
curl -X POST http://localhost:3000/upload \
  -F "file=@loud_track.wav" \
  -F "preset=mastering" \
  -F "outputFormat=mp3"

# Test format conversion
curl -X POST http://localhost:3000/upload \
  -F "file=@test.wav" \
  -F "preset=mastering" \
  -F "outputFormat=flac"
```

---

## Summary of Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/src/services/masteringProcessor.ts` | **CREATE** | New mastering pipeline with analysis, decision engine, and processing |
| `backend/src/services/formatConverter.ts` | **CREATE** | Format conversion module (mastering outputs WAV, then converts) |
| `backend/src/services/audioProcessor.ts` | **MODIFY** | Add mastering preset detection and route to new processor |
| `backend/src/schemas/presets.ts` | **MODIFY** | Update mastering preset description and true peak target |
| `backend/src/__tests__/masteringProcessor.test.ts` | **CREATE** | Unit tests for filter chain builder |

---

## Key Differences from Original Script

| Aspect | Original Script | Implementation |
|--------|----------------|----------------|
| Environment | Bash + bc | TypeScript + Bun |
| User interaction | `read -p` prompts | Async callbacks |
| Temp files | Manual cleanup | Automatic with `unlink` |
| Error handling | Exit codes | Typed Result objects |
| Progress | Console output | WebSocket updates |
| Format conversion | Not included | Separate step after mastering |

---

## Prompt for Claude Code

```
Read the file MASTERING_UPGRADE_INSTRUCTIONS.md in this directory. 

Clone https://github.com/miikkis-gh/audiolevel and implement the changes described:

1. Create backend/src/services/masteringProcessor.ts with the analysis, decision engine, and processing functions
2. Create backend/src/services/formatConverter.ts for post-mastering format conversion
3. Modify backend/src/services/audioProcessor.ts to detect the "mastering" preset and route it to the new processor
4. Update backend/src/schemas/presets.ts with the updated mastering description
5. Create unit tests in backend/src/__tests__/masteringProcessor.test.ts

The mastering preset should:
- Analyze input audio for LUFS, LRA, true peak, and crest factor
- Conditionally apply compression (if crest factor > 10 AND LRA > 5)
- Conditionally apply saturation (if LUFS < -12 AND true peak < -1.5)
- Always apply: highpass(25Hz), loudnorm(-9 LUFS), alimiter(-0.6 dBTP)
- Master to 48kHz 24-bit WAV first, then convert to requested output format

Run the tests to verify the implementation works.
```
