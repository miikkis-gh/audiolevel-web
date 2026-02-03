import { describe, expect, test } from 'bun:test';
import { ALLOWED_MIME_TYPES } from '../schemas/upload';

describe('MIME Type Validation', () => {
  test('Common audio MIME types are allowed', () => {
    const allowedTypes = [
      'audio/wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/flac',
      'audio/aac',
      'audio/mp4',
      'audio/x-m4a',
      'audio/ogg',
      'audio/x-wav',
      'audio/x-flac',
      'audio/vorbis',
      'audio/opus',
      'audio/aiff',
      'audio/x-aiff',
      'audio/webm',
      'audio/x-ms-wma',
      'audio/amr',
      'audio/ac3',
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
