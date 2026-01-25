import { z } from 'zod';

export const ALLOWED_MIME_TYPES = [
  'audio/wav',
  'audio/x-wav',
  'audio/mp3',
  'audio/mpeg',
  'audio/flac',
  'audio/x-flac',
  'audio/aac',
  'audio/ogg',
  'audio/vorbis',
] as const;

export const PRESETS = [
  'podcast',
  'broadcast',
  'youtube',
  'streaming',
  'mastering',
  'audiobook',
] as const;

export type Preset = typeof PRESETS[number];

export const uploadRequestSchema = z.object({
  preset: z.enum(PRESETS).default('podcast'),
});

export const fileValidationSchema = z.object({
  name: z.string().min(1),
  size: z.number().positive(),
  type: z.string(),
});

export type UploadRequest = z.infer<typeof uploadRequestSchema>;
export type FileValidation = z.infer<typeof fileValidationSchema>;
