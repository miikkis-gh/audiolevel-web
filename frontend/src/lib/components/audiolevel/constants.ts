// Types
export interface Reason {
  signal: string;
  detail: string;
}

export interface Levels {
  integrated: string;
  truePeak: string;
  lra: string;
}

export interface SingleReportData {
  detectedAs: string;
  confidence: string;
  reasons: Reason[];
  before: Levels;
  after: Levels;
  target: string;
  standard: string;
  notes: string[];
}

export interface BatchReportData {
  type: string;
  conf: string;
  reasons: Reason[];
  before: Levels;
  after: Levels;
  target: string;
  standard: string;
  notes: string[];
}

export interface BatchFile {
  id: string;
  name: string;
  progress: number;
  fileState: 'pending' | 'processing' | 'complete';
  report: BatchReportData;
}

export interface OverrideType {
  key: string;
  label: string;
  target: string;
  standard: string;
}

export interface Stage {
  at: number;
  label: string;
}

// Constants
export const SINGLE_REPORT: SingleReportData = {
  detectedAs: 'Music / Song',
  confidence: 'HIGH',
  reasons: [
    { signal: 'Stereo channel layout', detail: 'common for music' },
    { signal: 'Silence ratio: 2.3%', detail: 'very low, typical for music' },
    { signal: 'Sample rate: 44,100 Hz', detail: 'CD standard' },
    { signal: 'Loudness range: 5.8 LU', detail: 'compressed, modern music' },
    { signal: 'Duration: 3:42', detail: 'typical song length' },
    { signal: 'Crest factor: 7.2 dB', detail: 'moderately compressed' },
  ],
  before: { integrated: '-18.2 LUFS', truePeak: '-0.3 dBTP', lra: '5.8 LU' },
  after: { integrated: '-14.0 LUFS', truePeak: '-1.0 dBTP', lra: '5.4 LU' },
  target: '-14 LUFS / -1 dBTP',
  standard: 'Streaming (Spotify / Apple Music / YouTube)',
  notes: [
    'True peak exceeded -1 dBTP — limiter applied',
    'No DC offset detected',
    'No clipping detected in source',
  ],
};

export const OVERRIDE_TYPES: OverrideType[] = [
  { key: 'MUSIC_SONG', label: 'Music / Song', target: '-14 LUFS / -1 dBTP', standard: 'Streaming (Spotify / Apple Music / YouTube)' },
  { key: 'MUSIC_MIX', label: 'Music / Mix', target: '-14 LUFS / -1 dBTP', standard: 'Streaming (Spotify / Apple Music / YouTube)' },
  { key: 'SPEECH_PODCAST', label: 'Podcast / Talk', target: '-16 LUFS / -1 dBTP', standard: 'Podcast (Spotify / Apple compatible)' },
  { key: 'SPEECH_AUDIOBOOK', label: 'Audiobook', target: '-19 LUFS / -1 dBTP', standard: 'Audiobook (ACX / Audible compatible)' },
  { key: 'SPEECH_VO', label: 'Voiceover', target: '-16 LUFS / -1 dBTP', standard: 'Voiceover / Broadcast' },
  { key: 'SFX_SAMPLE', label: 'SFX / Sample', target: 'Peak normalize to -1 dBFS', standard: 'SFX / Sample library' },
];

export const MAX_BATCH = 10;

export const BATCH_MOCK_POOL: BatchReportData[] = [
  {
    type: 'Music / Song', conf: 'HIGH',
    reasons: [
      { signal: 'Stereo channel layout', detail: 'common for music' },
      { signal: 'Silence ratio: 2.3%', detail: 'very low, typical for music' },
      { signal: 'Sample rate: 44,100 Hz', detail: 'CD standard' },
      { signal: 'Loudness range: 5.8 LU', detail: 'compressed, modern music' },
      { signal: 'Crest factor: 7.2 dB', detail: 'moderately compressed' },
    ],
    before: { integrated: '-18.2 LUFS', truePeak: '-0.3 dBTP', lra: '5.8 LU' },
    after: { integrated: '-14.0 LUFS', truePeak: '-1.0 dBTP', lra: '5.4 LU' },
    target: '-14 LUFS / -1 dBTP',
    standard: 'Streaming (Spotify / Apple Music / YouTube)',
    notes: ['True peak exceeded -1 dBTP — limiter applied', 'No DC offset detected'],
  },
  {
    type: 'Podcast / Talk', conf: 'HIGH',
    reasons: [
      { signal: 'Mono channel layout', detail: 'common for speech' },
      { signal: 'Silence ratio: 28.4%', detail: 'typical for speech pauses' },
      { signal: 'Sample rate: 48,000 Hz', detail: 'broadcast standard' },
      { signal: 'Loudness range: 14.2 LU', detail: 'high, natural speech dynamics' },
      { signal: "Filename contains 'episode'", detail: 'strong keyword match' },
    ],
    before: { integrated: '-22.4 LUFS', truePeak: '-1.8 dBTP', lra: '14.2 LU' },
    after: { integrated: '-16.0 LUFS', truePeak: '-1.0 dBTP', lra: '11.8 LU' },
    target: '-16 LUFS / -1 dBTP',
    standard: 'Podcast (Spotify / Apple compatible)',
    notes: ['No clipping detected in source', 'DC offset of 0.02 corrected'],
  },
  {
    type: 'Music / Song', conf: 'HIGH',
    reasons: [
      { signal: 'Stereo channel layout', detail: 'common for music' },
      { signal: 'Silence ratio: 1.1%', detail: 'very low, continuous audio' },
      { signal: 'Loudness range: 4.2 LU', detail: 'heavily compressed' },
      { signal: 'Crest factor: 5.8 dB', detail: 'heavily limited' },
      { signal: 'Duration: 4:18', detail: 'typical song length' },
    ],
    before: { integrated: '-15.8 LUFS', truePeak: '0.1 dBTP', lra: '4.2 LU' },
    after: { integrated: '-14.0 LUFS', truePeak: '-1.0 dBTP', lra: '4.0 LU' },
    target: '-14 LUFS / -1 dBTP',
    standard: 'Streaming (Spotify / Apple Music / YouTube)',
    notes: ['Source had inter-sample clipping at 0.1 dBTP', 'True peak limiter applied'],
  },
  {
    type: 'Voiceover', conf: 'MEDIUM',
    reasons: [
      { signal: 'Mono channel layout', detail: 'common for speech' },
      { signal: 'Silence ratio: 18.6%', detail: 'speech with pauses' },
      { signal: 'Duration: 0:42', detail: 'short, typical VO length' },
      { signal: 'Crest factor: 14.1 dB', detail: 'dynamic, uncompressed' },
    ],
    before: { integrated: '-26.1 LUFS', truePeak: '-4.2 dBTP', lra: '12.1 LU' },
    after: { integrated: '-16.0 LUFS', truePeak: '-1.0 dBTP', lra: '10.4 LU' },
    target: '-16 LUFS / -1 dBTP',
    standard: 'Voiceover / Broadcast',
    notes: ['No clipping detected', 'Significant gain increase applied (+10.1 dB)'],
  },
  {
    type: 'Audiobook', conf: 'HIGH',
    reasons: [
      { signal: 'Mono channel layout', detail: 'common for speech' },
      { signal: 'Silence ratio: 34.2%', detail: 'high, conversational pace' },
      { signal: 'Duration: 1:42:18', detail: 'long form, typical chapter' },
      { signal: 'Loudness range: 16.8 LU', detail: 'very dynamic, natural narration' },
      { signal: "Filename contains 'chapter'", detail: 'strong keyword match' },
    ],
    before: { integrated: '-24.3 LUFS', truePeak: '-3.1 dBTP', lra: '16.8 LU' },
    after: { integrated: '-19.0 LUFS', truePeak: '-1.0 dBTP', lra: '14.2 LU' },
    target: '-19 LUFS / -1 dBTP',
    standard: 'Audiobook (ACX / Audible compatible)',
    notes: ['No clipping detected', 'Dynamics preserved for narration clarity'],
  },
  {
    type: 'SFX / Sample', conf: 'MEDIUM',
    reasons: [
      { signal: 'Duration: 0:03', detail: 'very short, typical sample' },
      { signal: 'Silence ratio: 42.1%', detail: 'sparse, transient content' },
      { signal: 'Stereo channel layout', detail: 'spatial effect' },
      { signal: 'Crest factor: 18.4 dB', detail: 'extremely dynamic, transient' },
    ],
    before: { integrated: '-12.1 LUFS', truePeak: '-0.1 dBTP', lra: '2.1 LU' },
    after: { integrated: 'N/A', truePeak: '-1.0 dBFS', lra: 'N/A' },
    target: 'Peak normalize to -1 dBFS',
    standard: 'SFX / Sample library',
    notes: ['LUFS normalization skipped — file too short', 'Peak normalized instead'],
  },
  {
    type: 'Music / Mix', conf: 'HIGH',
    reasons: [
      { signal: 'Stereo channel layout', detail: 'common for music' },
      { signal: 'Silence ratio: 0.8%', detail: 'continuous mix' },
      { signal: 'Duration: 58:22', detail: 'long form, typical DJ set' },
      { signal: 'Loudness range: 7.4 LU', detail: 'moderate dynamics' },
      { signal: 'Crest factor: 8.1 dB', detail: 'moderate compression' },
    ],
    before: { integrated: '-17.5 LUFS', truePeak: '-0.8 dBTP', lra: '7.4 LU' },
    after: { integrated: '-14.0 LUFS', truePeak: '-1.0 dBTP', lra: '7.0 LU' },
    target: '-14 LUFS / -1 dBTP',
    standard: 'Streaming (Spotify / Apple Music / YouTube)',
    notes: ['No clipping detected', 'Long file — dual-pass processing applied'],
  },
  {
    type: 'Podcast / Talk', conf: 'MEDIUM',
    reasons: [
      { signal: 'Stereo channel layout', detail: 'multi-mic interview' },
      { signal: 'Silence ratio: 22.1%', detail: 'typical for conversation' },
      { signal: 'Sample rate: 48,000 Hz', detail: 'broadcast standard' },
      { signal: 'Loudness range: 11.3 LU', detail: 'moderate, conversational' },
    ],
    before: { integrated: '-20.8 LUFS', truePeak: '-2.1 dBTP', lra: '11.3 LU' },
    after: { integrated: '-16.0 LUFS', truePeak: '-1.0 dBTP', lra: '9.8 LU' },
    target: '-16 LUFS / -1 dBTP',
    standard: 'Podcast (Spotify / Apple compatible)',
    notes: ['No clipping detected', 'Stereo maintained — multi-mic detected'],
  },
];

export const STAGES: Stage[] = [
  { at: 0, label: 'Reading metadata' },
  { at: 18, label: 'Analyzing loudness' },
  { at: 38, label: 'Detecting silence' },
  { at: 55, label: 'Classifying content' },
  { at: 70, label: 'Normalizing audio' },
  { at: 90, label: 'Verifying output' },
];

export const PROFILE_COLORS: Record<string, [number, number, number]> = {
  'Music / Song': [100, 180, 255],
  'Music / Mix': [180, 130, 255],
  'Podcast / Talk': [255, 180, 80],
  'Audiobook': [80, 210, 160],
  'Voiceover': [255, 120, 140],
  'SFX / Sample': [255, 100, 220],
};

export const PROFILE_COLOR_LIST = Object.values(PROFILE_COLORS);

export type Mode = 'idle' | 'processing' | 'complete' | 'splitting' | 'batch' | 'merging' | 'batch-complete';
export type ParticleState = 'idle' | 'processing' | 'complete';
