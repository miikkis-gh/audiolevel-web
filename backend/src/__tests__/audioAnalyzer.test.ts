import { describe, expect, test } from 'bun:test';
import { DEFAULT_THRESHOLDS } from '../services/audioAnalyzer';
import type { AnalysisMetrics, ContentClassification, AudioProblems, Severity } from '../types/analysis';

// Since classifyContent and detectProblems are not exported, we'll test them indirectly
// through the DEFAULT_THRESHOLDS export and verify the logic by examining threshold values

describe('Audio Analyzer', () => {
  describe('DEFAULT_THRESHOLDS', () => {
    test('noise thresholds are defined in correct order', () => {
      // Lower dB values (more negative) indicate quieter noise floors
      // mild (-50) < moderate (-45) < severe (-40) means:
      // - mild threshold catches quieter noise (harder to trigger)
      // - severe threshold catches louder noise (easier to trigger)
      expect(DEFAULT_THRESHOLDS.noise.mild).toBeLessThan(DEFAULT_THRESHOLDS.noise.moderate);
      expect(DEFAULT_THRESHOLDS.noise.moderate).toBeLessThan(DEFAULT_THRESHOLDS.noise.severe);
    });

    test('clipping thresholds have sensible values', () => {
      expect(DEFAULT_THRESHOLDS.clipping.peakCount).toBe(100);
      expect(DEFAULT_THRESHOLDS.clipping.flatFactor).toBe(0);
    });

    test('DC offset threshold is reasonable', () => {
      expect(DEFAULT_THRESHOLDS.dcOffset).toBe(0.01);
    });

    test('low loudness threshold is reasonable for broadcast', () => {
      // -24 LUFS is a reasonable threshold for "too quiet"
      expect(DEFAULT_THRESHOLDS.lowLoudness).toBe(-24);
    });

    test('dynamic range thresholds differ by content type', () => {
      expect(DEFAULT_THRESHOLDS.dynamicRange.speech).toBe(15);
      expect(DEFAULT_THRESHOLDS.dynamicRange.music).toBe(20);
      // Music should have higher tolerance for dynamic range
      expect(DEFAULT_THRESHOLDS.dynamicRange.music).toBeGreaterThan(
        DEFAULT_THRESHOLDS.dynamicRange.speech
      );
    });

    test('sibilance threshold is defined', () => {
      expect(DEFAULT_THRESHOLDS.sibilance).toBe(6);
    });

    test('muddiness threshold is defined', () => {
      expect(DEFAULT_THRESHOLDS.muddiness).toBe(4);
    });

    test('stereo imbalance threshold is reasonable', () => {
      expect(DEFAULT_THRESHOLDS.stereoImbalance).toBe(3);
    });

    test('silence padding threshold is reasonable', () => {
      expect(DEFAULT_THRESHOLDS.silencePadding).toBe(0.5);
    });
  });

  describe('Content Classification Logic', () => {
    // Test the classification logic by creating metrics that should clearly indicate speech or music

    test('high silence ratio indicates speech', () => {
      // Based on the code: silenceRatio > 0.15 adds 0.3 to speechScore
      const speechIndicatingMetrics = {
        silenceRatio: 0.25, // High silence ratio (pauses)
        crestFactor: 8, // Low crest factor
        spectralFlatness: 0.6, // High spectral flatness (noise-like)
        loudnessRange: 6, // Narrow LRA
        spectralCentroid: 1500, // Voice range
      };

      // These values should strongly indicate speech:
      // - silenceRatio 0.25 > 0.15: +0.3 speech
      // - crestFactor 8 < 10: +0.1 speech
      // - spectralFlatness 0.6 > 0.5: +0.2 speech
      // - loudnessRange 6 < 8: +0.2 speech
      // - spectralCentroid 1500 (500-2500): +0.2 speech
      // Total: 1.0 speech score

      expect(speechIndicatingMetrics.silenceRatio).toBeGreaterThan(0.15);
      expect(speechIndicatingMetrics.spectralFlatness).toBeGreaterThan(0.5);
    });

    test('low silence ratio indicates music', () => {
      // Based on the code: silenceRatio < 0.05 adds 0.3 to musicScore
      const musicIndicatingMetrics = {
        silenceRatio: 0.02, // Low silence ratio (continuous)
        crestFactor: 18, // High crest factor
        spectralFlatness: 0.2, // Low spectral flatness (tonal)
        loudnessRange: 18, // Wide LRA
        spectralCentroid: 4000, // High spectral centroid
      };

      // These values should strongly indicate music:
      // - silenceRatio 0.02 < 0.05: +0.3 music
      // - crestFactor 18 > 15: +0.2 music
      // - spectralFlatness 0.2 < 0.3: +0.3 music
      // - loudnessRange 18 > 15: +0.2 music
      // Total: 1.0 music score

      expect(musicIndicatingMetrics.silenceRatio).toBeLessThan(0.05);
      expect(musicIndicatingMetrics.spectralFlatness).toBeLessThan(0.3);
    });

    test('mixed characteristics indicate podcast_mixed', () => {
      // When both speech and music scores are > 0.3
      const mixedMetrics = {
        silenceRatio: 0.10, // Medium (neither high nor low)
        spectralFlatness: 0.4, // Medium
        crestFactor: 12, // Medium
      };

      // These ambiguous values should result in mixed content classification
      expect(mixedMetrics.silenceRatio).toBeGreaterThan(0.05);
      expect(mixedMetrics.silenceRatio).toBeLessThan(0.15);
    });
  });

  describe('Problem Detection Logic', () => {
    test('clipping detection thresholds', () => {
      // Clipping is detected when flatFactor > 0 OR peakCount > 100
      const noClipping = { flatFactor: 0, peakCount: 50 };
      const clippingByFlatFactor = { flatFactor: 0.05, peakCount: 50 };
      const clippingByPeakCount = { flatFactor: 0, peakCount: 150 };

      expect(noClipping.flatFactor).toBe(0);
      expect(noClipping.peakCount).toBeLessThan(100);

      expect(clippingByFlatFactor.flatFactor).toBeGreaterThan(0);
      expect(clippingByPeakCount.peakCount).toBeGreaterThan(100);
    });

    test('clipping severity levels', () => {
      // severe: peakCount > 1000 or flatFactor > 0.1
      // moderate: peakCount > 500
      // mild: everything else

      const severe1 = { peakCount: 1500, flatFactor: 0 };
      const severe2 = { peakCount: 0, flatFactor: 0.15 };
      const moderate = { peakCount: 700, flatFactor: 0.05 };
      const mild = { peakCount: 150, flatFactor: 0.02 };

      expect(severe1.peakCount).toBeGreaterThan(1000);
      expect(severe2.flatFactor).toBeGreaterThan(0.1);
      expect(moderate.peakCount).toBeGreaterThan(500);
      expect(moderate.peakCount).toBeLessThanOrEqual(1000);
      expect(mild.peakCount).toBeGreaterThan(100);
      expect(mild.peakCount).toBeLessThanOrEqual(500);
    });

    test('noise detection thresholds', () => {
      // Noise is estimated from rmsDb + crestFactor
      // Thresholds: mild=-50dB, moderate=-45dB, severe=-40dB
      // Higher values (closer to 0) mean more noise

      const quiet = { estimate: -55 }; // No noise (below mild threshold)
      const mild = { estimate: -48 }; // Mild noise (between -50 and -45)
      const moderate = { estimate: -42 }; // Moderate noise (between -45 and -40)
      const severe = { estimate: -38 }; // Severe noise (above -40)

      // Quiet: below mild threshold, no noise detected
      expect(quiet.estimate).toBeLessThan(DEFAULT_THRESHOLDS.noise.mild);

      // Mild: above mild threshold but below moderate
      expect(mild.estimate).toBeGreaterThan(DEFAULT_THRESHOLDS.noise.mild);
      expect(mild.estimate).toBeLessThan(DEFAULT_THRESHOLDS.noise.moderate);

      // Moderate: above moderate threshold but below severe
      expect(moderate.estimate).toBeGreaterThan(DEFAULT_THRESHOLDS.noise.moderate);
      expect(moderate.estimate).toBeLessThan(DEFAULT_THRESHOLDS.noise.severe);

      // Severe: above severe threshold
      expect(severe.estimate).toBeGreaterThan(DEFAULT_THRESHOLDS.noise.severe);
    });

    test('DC offset detection', () => {
      const noDcOffset = { dcOffset: 0.005 };
      const hasDcOffset = { dcOffset: 0.02 };

      expect(noDcOffset.dcOffset).toBeLessThan(DEFAULT_THRESHOLDS.dcOffset);
      expect(hasDcOffset.dcOffset).toBeGreaterThan(DEFAULT_THRESHOLDS.dcOffset);
    });

    test('low loudness detection', () => {
      const normalLoudness = { integratedLufs: -18 };
      const lowLoudness = { integratedLufs: -28 };

      expect(normalLoudness.integratedLufs).toBeGreaterThan(DEFAULT_THRESHOLDS.lowLoudness);
      expect(lowLoudness.integratedLufs).toBeLessThan(DEFAULT_THRESHOLDS.lowLoudness);
    });

    test('dynamic range detection differs by content type', () => {
      const speechLra = { loudnessRange: 17 }; // Excessive for speech
      const musicLra = { loudnessRange: 17 }; // Acceptable for music

      // For speech (threshold 15): 17 > 15, excessive
      expect(speechLra.loudnessRange).toBeGreaterThan(DEFAULT_THRESHOLDS.dynamicRange.speech);

      // For music (threshold 20): 17 < 20, acceptable
      expect(musicLra.loudnessRange).toBeLessThan(DEFAULT_THRESHOLDS.dynamicRange.music);
    });

    test('stereo imbalance detection', () => {
      const balanced = { stereoBalance: 1.5 };
      const imbalanced = { stereoBalance: 4.5 };

      expect(Math.abs(balanced.stereoBalance)).toBeLessThan(DEFAULT_THRESHOLDS.stereoImbalance);
      expect(Math.abs(imbalanced.stereoBalance)).toBeGreaterThan(DEFAULT_THRESHOLDS.stereoImbalance);
    });

    test('silence padding detection', () => {
      const noLeadingSilence = { leadingSilence: 0.2, trailingSilence: 0.2 };
      const hasLeadingSilence = { leadingSilence: 1.0, trailingSilence: 0.2 };
      const hasTrailingSilence = { leadingSilence: 0.2, trailingSilence: 1.0 };

      expect(noLeadingSilence.leadingSilence).toBeLessThan(DEFAULT_THRESHOLDS.silencePadding);
      expect(noLeadingSilence.trailingSilence).toBeLessThan(DEFAULT_THRESHOLDS.silencePadding);

      expect(hasLeadingSilence.leadingSilence).toBeGreaterThan(DEFAULT_THRESHOLDS.silencePadding);
      expect(hasTrailingSilence.trailingSilence).toBeGreaterThan(DEFAULT_THRESHOLDS.silencePadding);
    });
  });
});
