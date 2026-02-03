import { describe, expect, test } from 'bun:test';
import {
  buildAnalyzeCommand,
  buildProbeCommand,
  parseLoudnessAnalysis,
  parseProbeOutput,
} from '../utils/ffmpeg';

describe('FFmpeg Command Builder', () => {
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
