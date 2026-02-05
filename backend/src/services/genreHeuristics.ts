/**
 * Genre Heuristics Service
 *
 * Guesses music genre based on audio analysis metrics.
 * Uses tempo estimation, dynamics, and spectral characteristics.
 *
 * @module services/genreHeuristics
 */

import type { AnalysisMetrics } from '../types/analysis';
import { logger } from '../utils/logger';

export type BroadGenre =
  | 'Electronic'
  | 'Rock'
  | 'Hip-Hop'
  | 'Pop'
  | 'Classical'
  | 'Jazz'
  | 'Folk/Acoustic'
  | 'Other';

export type GenreConfidence = 'low' | 'medium' | 'high';

export interface GenreGuess {
  broad: BroadGenre;
  confidence: GenreConfidence;
  scores: Record<BroadGenre, number>;
}

// Subcategories for each broad genre
export const GENRE_SUBCATEGORIES: Record<BroadGenre, string[]> = {
  Electronic: ['House', 'Techno', 'Drum & Bass', 'Dubstep', 'Trance', 'Ambient Electronic'],
  Rock: ['Alternative', 'Metal', 'Punk', 'Indie', 'Classic Rock'],
  'Hip-Hop': ['Rap', 'Trap', 'Lo-Fi Hip-Hop', 'R&B'],
  Pop: ['Synth Pop', 'Indie Pop', 'Dance Pop'],
  Classical: ['Orchestral', 'Chamber', 'Piano', 'Film Score'],
  Jazz: ['Smooth Jazz', 'Bebop', 'Fusion'],
  'Folk/Acoustic': ['Country', 'Singer-Songwriter', 'World'],
  Other: ['Podcast Intro', 'Sound Effects', 'Experimental'],
};

// All broad genres
export const BROAD_GENRES: BroadGenre[] = [
  'Electronic',
  'Rock',
  'Hip-Hop',
  'Pop',
  'Classical',
  'Jazz',
  'Folk/Acoustic',
  'Other',
];

/**
 * Estimate tempo/BPM from spectral and dynamic characteristics
 * This is a rough heuristic, not actual beat detection
 */
function estimateTempoCategory(metrics: AnalysisMetrics): 'slow' | 'medium' | 'fast' {
  // Use crest factor and spectral characteristics as proxy for tempo
  // High crest factor with low spectral flatness often indicates slower, more dynamic music
  // Low crest factor with high spectral flatness often indicates faster, more consistent music

  const { crestFactor, spectralFlatness, loudnessRange } = metrics;

  // Fast music tends to have: lower crest factor, lower LRA, higher spectral flatness
  const fastScore =
    (crestFactor < 12 ? 1 : 0) + (loudnessRange < 8 ? 1 : 0) + (spectralFlatness > 0.3 ? 1 : 0);

  // Slow music tends to have: higher crest factor, higher LRA, lower spectral flatness
  const slowScore =
    (crestFactor > 15 ? 1 : 0) + (loudnessRange > 12 ? 1 : 0) + (spectralFlatness < 0.2 ? 1 : 0);

  if (fastScore >= 2) return 'fast';
  if (slowScore >= 2) return 'slow';
  return 'medium';
}

/**
 * Analyze energy distribution across frequency bands
 */
function analyzeEnergyDistribution(metrics: AnalysisMetrics): {
  bassHeavy: boolean;
  trebleHeavy: boolean;
  balanced: boolean;
  midFocused: boolean;
} {
  const { lowFreqEnergy, midFreqEnergy, highFreqEnergy, veryHighFreqEnergy } = metrics;
  const total = lowFreqEnergy + midFreqEnergy + highFreqEnergy + veryHighFreqEnergy;

  if (total === 0) {
    return { bassHeavy: false, trebleHeavy: false, balanced: true, midFocused: false };
  }

  const lowRatio = lowFreqEnergy / total;
  const midRatio = midFreqEnergy / total;
  const highRatio = (highFreqEnergy + veryHighFreqEnergy) / total;

  return {
    bassHeavy: lowRatio > 0.35,
    trebleHeavy: highRatio > 0.3,
    balanced: Math.abs(lowRatio - highRatio) < 0.15,
    midFocused: midRatio > 0.45,
  };
}

/**
 * Guess genre from audio analysis metrics
 */
export function guessGenre(metrics: AnalysisMetrics): GenreGuess {
  const scores: Record<BroadGenre, number> = {
    Electronic: 0,
    Rock: 0,
    'Hip-Hop': 0,
    Pop: 0,
    Classical: 0,
    Jazz: 0,
    'Folk/Acoustic': 0,
    Other: 0,
  };

  const tempo = estimateTempoCategory(metrics);
  const energy = analyzeEnergyDistribution(metrics);
  const { loudnessRange, spectralFlatness, silenceRatio, crestFactor } = metrics;

  // === Tempo-based scoring ===
  if (tempo === 'fast') {
    scores['Electronic'] += 3;
    scores['Rock'] += 2;
    scores['Pop'] += 1;
  } else if (tempo === 'slow') {
    scores['Classical'] += 2;
    scores['Jazz'] += 2;
    scores['Folk/Acoustic'] += 2;
    scores['Hip-Hop'] += 1; // Lo-fi, slower hip-hop
  } else {
    // Medium tempo - could be anything
    scores['Pop'] += 2;
    scores['Rock'] += 1;
    scores['Hip-Hop'] += 1;
  }

  // === Dynamic range scoring ===
  if (loudnessRange > 15) {
    // Very dynamic
    scores['Classical'] += 3;
    scores['Jazz'] += 2;
    scores['Folk/Acoustic'] += 1;
  } else if (loudnessRange > 10) {
    // Moderately dynamic
    scores['Rock'] += 2;
    scores['Jazz'] += 1;
    scores['Folk/Acoustic'] += 1;
  } else if (loudnessRange < 6) {
    // Compressed/limited
    scores['Electronic'] += 3;
    scores['Hip-Hop'] += 3;
    scores['Pop'] += 2;
  } else {
    // Normal range
    scores['Pop'] += 1;
    scores['Rock'] += 1;
  }

  // === Energy distribution scoring ===
  if (energy.bassHeavy) {
    scores['Electronic'] += 2;
    scores['Hip-Hop'] += 3;
  }
  if (energy.trebleHeavy) {
    scores['Classical'] += 1;
    scores['Jazz'] += 1;
    scores['Folk/Acoustic'] += 1;
  }
  if (energy.midFocused) {
    scores['Rock'] += 2;
    scores['Pop'] += 1;
    scores['Folk/Acoustic'] += 1;
  }
  if (energy.balanced) {
    scores['Classical'] += 2;
    scores['Jazz'] += 1;
    scores['Pop'] += 1;
  }

  // === Spectral flatness scoring ===
  // High flatness = more noise-like (electronic, some rock)
  // Low flatness = more tonal (classical, jazz)
  if (spectralFlatness > 0.4) {
    scores['Electronic'] += 2;
    scores['Rock'] += 1;
  } else if (spectralFlatness < 0.15) {
    scores['Classical'] += 2;
    scores['Jazz'] += 1;
    scores['Folk/Acoustic'] += 1;
  }

  // === Silence ratio scoring ===
  // More silence often indicates classical/jazz with pauses
  if (silenceRatio > 0.1) {
    scores['Classical'] += 1;
    scores['Jazz'] += 1;
  } else if (silenceRatio < 0.02) {
    scores['Electronic'] += 1;
    scores['Pop'] += 1;
  }

  // === Crest factor scoring ===
  // High crest factor = more dynamic transients (acoustic music)
  // Low crest factor = more compressed (electronic, modern pop)
  if (crestFactor > 18) {
    scores['Classical'] += 2;
    scores['Jazz'] += 2;
    scores['Folk/Acoustic'] += 1;
  } else if (crestFactor < 10) {
    scores['Electronic'] += 2;
    scores['Hip-Hop'] += 1;
    scores['Pop'] += 1;
  }

  // Find the winner
  let maxScore = 0;
  let winner: BroadGenre = 'Other';
  let secondScore = 0;

  for (const [genre, score] of Object.entries(scores) as [BroadGenre, number][]) {
    if (score > maxScore) {
      secondScore = maxScore;
      maxScore = score;
      winner = genre;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // Determine confidence based on score margin
  let confidence: GenreConfidence;
  const margin = maxScore - secondScore;
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

  if (maxScore === 0 || totalScore === 0) {
    confidence = 'low';
    winner = 'Other';
  } else if (margin >= 4 && maxScore >= 8) {
    confidence = 'high';
  } else if (margin >= 2 && maxScore >= 5) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  logger.debug({ winner, confidence, scores, tempo, energy }, 'Genre heuristics result');

  return {
    broad: winner,
    confidence,
    scores,
  };
}

/**
 * Get the parent broad genre for a subcategory
 */
export function getBroadGenreForSubcategory(subcategory: string): BroadGenre | null {
  for (const [broad, subs] of Object.entries(GENRE_SUBCATEGORIES)) {
    if (subs.includes(subcategory)) {
      return broad as BroadGenre;
    }
  }
  return null;
}
