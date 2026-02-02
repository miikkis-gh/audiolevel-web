import { describe, expect, test } from 'bun:test';
import { uploadRequestSchema, ALLOWED_MIME_TYPES, PRESETS, type Preset } from '../schemas/upload';

describe('Upload Request Validation', () => {
  test('Valid preset values are accepted', () => {
    const validPresets: Preset[] = ['podcast', 'broadcast', 'youtube', 'streaming', 'mastering', 'audiobook'];

    for (const preset of validPresets) {
      const result = uploadRequestSchema.safeParse({ preset });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preset).toBe(preset);
      }
    }
  });

  test('Invalid preset values are rejected', () => {
    const invalidPresets = ['invalid', 'PODCAST', 'custom', '', 123];

    for (const preset of invalidPresets) {
      const result = uploadRequestSchema.safeParse({ preset });
      expect(result.success).toBe(false);
    }
  });

  test('Missing preset defaults to podcast', () => {
    const result = uploadRequestSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preset).toBe('podcast');
    }
  });

  test('All expected presets are defined', () => {
    expect(PRESETS).toContain('podcast');
    expect(PRESETS).toContain('broadcast');
    expect(PRESETS).toContain('youtube');
    expect(PRESETS).toContain('streaming');
    expect(PRESETS).toContain('mastering');
    expect(PRESETS).toContain('audiobook');
    expect(PRESETS.length).toBe(6);
  });
});

describe('MIME Type Validation', () => {
  test('Common audio MIME types are allowed', () => {
    const allowedTypes = [
      'audio/wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/flac',
      'audio/aac',
      'audio/ogg',
      'audio/x-wav',
      'audio/x-flac',
      'audio/vorbis',
    ] as const;

    for (const type of allowedTypes) {
      expect(ALLOWED_MIME_TYPES).toContain(type);
    }
  });

  test('Video and other MIME types are not allowed', () => {
    const notAllowed = [
      'video/mp4',
      'video/webm',
      'image/png',
      'image/jpeg',
      'application/pdf',
      'text/plain',
    ];

    for (const type of notAllowed) {
      expect(ALLOWED_MIME_TYPES).not.toContain(type);
    }
  });
});
