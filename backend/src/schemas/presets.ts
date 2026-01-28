import type { Preset } from './upload';

export interface PresetConfig {
  name: string;
  description: string;
  targetLufs: number;
  truePeak: number;
  loudnessRange?: number;
}

export const PRESET_CONFIGS: Record<Preset, PresetConfig> = {
  podcast: {
    name: 'Podcast',
    description: 'Optimized for spoken word podcasts',
    targetLufs: -16,
    truePeak: -1.5,
    loudnessRange: 7,
  },
  broadcast: {
    name: 'Broadcast',
    description: 'TV/Radio compliance (EBU R128)',
    targetLufs: -23,
    truePeak: -2,
    loudnessRange: 7,
  },
  youtube: {
    name: 'YouTube',
    description: 'Optimized for YouTube uploads',
    targetLufs: -14,
    truePeak: -1,
  },
  streaming: {
    name: 'Streaming',
    description: 'For Spotify, Apple Music, etc.',
    targetLufs: -14,
    truePeak: -1,
  },
  mastering: {
    name: 'Mastering',
    description: 'Adaptive mastering with dynamic compression, saturation, and limiting. Target: -9 LUFS, -0.5 dBTP (safe)',
    targetLufs: -9,
    truePeak: -0.5,  // Updated from -0.3 to safer value
    loudnessRange: 5,
    // Note: These values are informational. The actual processing
    // uses adaptive decisions based on input analysis.
  },
  audiobook: {
    name: 'Audiobook',
    description: 'ACX/Audible compliance',
    targetLufs: -18,
    truePeak: -3,
    loudnessRange: 8,
  },
};
