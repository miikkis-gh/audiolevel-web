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
    description: 'Loud masters for maximum impact',
    targetLufs: -9,
    truePeak: -0.3,
  },
  audiobook: {
    name: 'Audiobook',
    description: 'ACX/Audible compliance',
    targetLufs: -18,
    truePeak: -3,
    loudnessRange: 8,
  },
};
