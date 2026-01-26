import { describe, expect, test } from 'bun:test';
import {
  buildNormalizeCommand,
  buildAnalyzeCommand,
  buildProbeCommand,
  buildDurationCommand,
  parseLoudnessAnalysis,
  parseNormalizeProgress,
  parseProbeOutput,
} from '../utils/ffmpeg';

describe('FFmpeg Command Builder', () => {
  test('buildNormalizeCommand creates correct command', () => {
    const result = buildNormalizeCommand({
      inputPath: '/input/test.wav',
      outputPath: '/output/test.wav',
      preset: 'podcast',
    });

    expect(result.command).toBe('ffmpeg-normalize');
    expect(result.args).toContain('/input/test.wav');
    expect(result.args).toContain('-o');
    expect(result.args).toContain('/output/test.wav');
    expect(result.args).toContain('-t');
    expect(result.args).toContain('-16');  // Podcast LUFS
    expect(result.args).toContain('-tp');
    expect(result.args).toContain('-1.5'); // Podcast true peak
    expect(result.args).toContain('-f');   // Force overwrite
  });

  test('buildNormalizeCommand handles different presets', () => {
    const presets = ['podcast', 'broadcast', 'youtube', 'streaming', 'mastering', 'audiobook'] as const;

    for (const preset of presets) {
      const result = buildNormalizeCommand({
        inputPath: '/input.wav',
        outputPath: '/output.wav',
        preset,
      });

      expect(result.command).toBe('ffmpeg-normalize');
      expect(result.args).toContain('-t');
      expect(result.args).toContain('-tp');
    }
  });

  test('buildNormalizeCommand sets correct codec for different formats', () => {
    const formats = [
      { ext: 'wav', codec: 'pcm_s16le' },
      { ext: 'mp3', codec: 'libmp3lame' },
      { ext: 'flac', codec: 'flac' },
      { ext: 'aac', codec: 'aac' },
      { ext: 'ogg', codec: 'libvorbis' },
    ];

    for (const { ext, codec } of formats) {
      const result = buildNormalizeCommand({
        inputPath: '/input.wav',
        outputPath: `/output.${ext}`,
        preset: 'podcast',
      });

      expect(result.args).toContain('-c:a');
      expect(result.args).toContain(codec);
    }
  });

  test('buildAnalyzeCommand creates correct command', () => {
    const result = buildAnalyzeCommand('/test/audio.wav');

    expect(result.command).toBe('ffmpeg');
    expect(result.args).toContain('-i');
    expect(result.args).toContain('/test/audio.wav');
    expect(result.args).toContain('-af');
    expect(result.args.some(arg => arg.includes('loudnorm'))).toBe(true);
  });

  test('buildProbeCommand creates correct command', () => {
    const result = buildProbeCommand('/test/audio.wav');

    expect(result.command).toBe('ffprobe');
    expect(result.args).toContain('/test/audio.wav');
    expect(result.args).toContain('-print_format');
    expect(result.args).toContain('json');
  });

  test('buildDurationCommand creates correct command', () => {
    const result = buildDurationCommand('/test/audio.wav');

    expect(result.command).toBe('ffprobe');
    expect(result.args).toContain('/test/audio.wav');
    expect(result.args).toContain('-show_entries');
    expect(result.args.some(arg => arg.includes('duration'))).toBe(true);
  });
});

describe('FFmpeg Output Parsing', () => {
  test('parseLoudnessAnalysis parses valid JSON', () => {
    const stderr = `
      Some ffmpeg output
      {
        "input_i": "-23.5",
        "input_tp": "-1.2",
        "input_lra": "7.0"
      }
      More output
    `;

    const result = parseLoudnessAnalysis(stderr);

    expect(result).not.toBeNull();
    expect(result?.inputLufs).toBe(-23.5);
    expect(result?.inputTruePeak).toBe(-1.2);
    expect(result?.inputLoudnessRange).toBe(7.0);
  });

  test('parseLoudnessAnalysis returns null for invalid input', () => {
    const invalidInputs = [
      '',
      'no json here',
      '{"wrong": "format"}',
      'partial { "input_i":',
    ];

    for (const input of invalidInputs) {
      const result = parseLoudnessAnalysis(input);
      expect(result).toBeNull();
    }
  });

  test('parseNormalizeProgress extracts percentage', () => {
    expect(parseNormalizeProgress('Processing: 50%')).toBe(50);
    expect(parseNormalizeProgress('Progress: 75%')).toBe(75);
    expect(parseNormalizeProgress('100% complete')).toBe(100);
    expect(parseNormalizeProgress('No percentage')).toBe(0);
  });

  test('parseNormalizeProgress recognizes stage indicators', () => {
    expect(parseNormalizeProgress('First pass...')).toBe(10);
    expect(parseNormalizeProgress('Second pass...')).toBe(50);
    expect(parseNormalizeProgress('Writing output...')).toBe(90);
  });

  test('parseProbeOutput parses valid probe output', () => {
    const output = JSON.stringify({
      streams: [
        {
          codec_type: 'audio',
          codec_name: 'pcm_s16le',
          sample_rate: '44100',
          channels: 2,
        },
      ],
      format: {
        duration: '120.5',
        bit_rate: '1411200',
        format_name: 'wav',
      },
    });

    const result = parseProbeOutput(output);

    expect(result).not.toBeNull();
    expect(result?.duration).toBe(120.5);
    expect(result?.sampleRate).toBe(44100);
    expect(result?.channels).toBe(2);
    expect(result?.codec).toBe('pcm_s16le');
    expect(result?.format).toBe('wav');
  });

  test('parseProbeOutput returns null for invalid input', () => {
    const invalidInputs = [
      '',
      'not json',
      '{}',
      '{"streams": []}',
    ];

    for (const input of invalidInputs) {
      const result = parseProbeOutput(input);
      expect(result).toBeNull();
    }
  });
});
