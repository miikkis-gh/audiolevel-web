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

// Intelligent processing types
export interface ProblemDetected {
  problem: string;
  details: string;
  severity?: 'mild' | 'moderate' | 'severe';
}

export interface CandidateTested {
  name: string;
  score: number;
  isWinner: boolean;
}

export interface IntelligentProcessingReport {
  problemsDetected: ProblemDetected[];
  processingApplied: string[];
  candidatesTested: CandidateTested[];
  winnerReason: string;
  /** Method used for perceptual quality scoring */
  qualityMethod?: 'spectral';
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
  // Optional intelligent processing data
  intelligentProcessing?: IntelligentProcessingReport;
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
  // Optional intelligent processing data
  intelligentProcessing?: IntelligentProcessingReport;
}

export interface BatchFile {
  id: string;
  name: string;
  progress: number;
  fileState: 'pending' | 'processing' | 'complete' | 'error';
  report?: BatchReportData;
  jobId?: string;
  error?: string;
  downloadUrl?: string;
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
  intelligentProcessing: {
    problemsDetected: [
      { problem: 'True peak clipping', details: 'Peak at -0.3 dBTP exceeds target', severity: 'mild' },
      { problem: 'Low loudness', details: 'Source at -18.2 LUFS, target is -14 LUFS', severity: 'moderate' },
    ],
    processingApplied: [
      'High-pass filter (30 Hz)',
      'Loudness normalization to -14 LUFS',
      'True peak limiting to -1 dBTP',
    ],
    candidatesTested: [
      { name: 'Conservative', score: 85, isWinner: false },
      { name: 'Balanced', score: 92, isWinner: true },
      { name: 'Aggressive', score: 78, isWinner: false },
    ],
    winnerReason: 'Best loudness accuracy with preserved dynamics',
  },
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
