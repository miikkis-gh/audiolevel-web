import { z } from 'zod';

export const ALLOWED_MIME_TYPES = [
  // WAV
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  // MP3
  'audio/mp3',
  'audio/mpeg',
  // FLAC
  'audio/flac',
  'audio/x-flac',
  // AAC/M4A
  'audio/aac',
  'audio/aacp',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  // OGG/Vorbis
  'audio/ogg',
  'audio/vorbis',
  // Opus
  'audio/opus',
  // AIFF
  'audio/aiff',
  'audio/x-aiff',
  // WebM
  'audio/webm',
  // Matroska
  'audio/x-matroska',
  // WMA
  'audio/x-ms-wma',
  // CAF (Core Audio Format)
  'audio/x-caf',
  // AU/SND
  'audio/basic',
  // AMR
  'audio/amr',
  // WavPack
  'audio/x-wavpack',
  // APE (Monkey's Audio)
  'audio/x-ape',
  'audio/ape',
  // AC3/Dolby
  'audio/ac3',
  'audio/vnd.dolby.dd-raw',
  // DTS
  'audio/vnd.dts',
  'audio/vnd.dts.hd',
  // MP2
  'audio/mp2',
  // MPEG-4 generic
  'audio/x-mp4',
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
