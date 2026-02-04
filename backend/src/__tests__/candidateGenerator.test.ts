import { describe, expect, test } from 'bun:test';
import { generateCandidates, getFilterChain } from '../services/candidateGenerator';
import type { AnalysisResult, ContentType, Severity } from '../types/analysis';

// Helper to create mock analysis result
function createMockAnalysis(
  contentType: ContentType,
  options: Partial<{
    noiseFloor: { detected: boolean; severity: Severity };
    sibilance: { detected: boolean; severity: Severity };
    muddiness: { detected: boolean; severity: Severity };
    excessiveDynamicRange: { detected: boolean; severity: Severity };
    loudnessRange: number;
  }> = {}
): AnalysisResult {
  const noNoise = { detected: false, severity: 'none' as Severity, levelDb: -60 };
  const noSibilance = { detected: false, severity: 'none' as Severity, energyRatio: 0.2 };
  const noMuddiness = { detected: false, severity: 'none' as Severity, energyRatio: 0.8 };
  const noExcessiveLra = { detected: false, severity: 'none' as Severity, lra: 8 };

  return {
    contentType: {
      type: contentType,
      confidence: 0.85,
      signals: [],
    },
    problems: {
      clipping: { detected: false, severity: 'none', peakCount: 0, flatFactor: 0 },
      noiseFloor: options.noiseFloor
        ? { ...noNoise, ...options.noiseFloor }
        : noNoise,
      dcOffset: { detected: false, value: 0 },
      lowLoudness: { detected: false, integratedLufs: -16 },
      excessiveDynamicRange: options.excessiveDynamicRange
        ? { ...noExcessiveLra, ...options.excessiveDynamicRange }
        : noExcessiveLra,
      sibilance: options.sibilance
        ? { ...noSibilance, ...options.sibilance }
        : noSibilance,
      muddiness: options.muddiness
        ? { ...noMuddiness, ...options.muddiness }
        : noMuddiness,
      stereoImbalance: { detected: false, differenceDb: 0 },
      silencePadding: { detected: false, startSeconds: 0, endSeconds: 0 },
    },
    metrics: {
      channels: 2,
      sampleRate: 44100,
      bitDepth: 16,
      duration: 180,
      integratedLufs: -18,
      loudnessRange: options.loudnessRange ?? 8,
      truePeak: -1.5,
      rmsDb: -20,
      peakDb: -1,
      crestFactor: 19,
      flatFactor: 0,
      peakCount: 0,
      silenceRatio: contentType === 'speech' ? 0.25 : 0.02,
      leadingSilence: 0,
      trailingSilence: 0,
      spectralCentroid: contentType === 'speech' ? 1500 : 3000,
      spectralFlatness: contentType === 'speech' ? 0.6 : 0.2,
      lowFreqEnergy: 0.5,
      midFreqEnergy: 0.5,
      highFreqEnergy: 0.3,
      veryHighFreqEnergy: 0.2,
      dcOffset: 0,
      stereoBalance: 0,
    },
    problemDescriptions: [],
  };
}

describe('Candidate Generator', () => {
  describe('generateCandidates', () => {
    test('generates at least 3 candidates for clean audio', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);

      expect(result.candidates.length).toBeGreaterThanOrEqual(3);
      expect(result.contentType).toBe('music');
    });

    test('generates 4 candidates when significant problems detected', () => {
      const analysis = createMockAnalysis('speech', {
        noiseFloor: { detected: true, severity: 'moderate' },
      });
      const result = generateCandidates(analysis);

      // Should include aggressive candidate when moderate/severe problems present
      expect(result.candidates.length).toBe(4);
      expect(result.candidates.some(c => c.name === 'Aggressive')).toBe(true);
    });

    test('always includes Conservative candidate', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);

      const conservative = result.candidates.find(c => c.name === 'Conservative');
      expect(conservative).toBeDefined();
    });

    test('always includes Balanced candidate', () => {
      const analysis = createMockAnalysis('speech');
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');
      expect(balanced).toBeDefined();
    });

    test('always includes content-optimized candidate', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);

      const optimized = result.candidates.find(c => c.name.includes('Optimized'));
      expect(optimized).toBeDefined();
    });

    test('includes reasoning in result', () => {
      const analysis = createMockAnalysis('speech');
      const result = generateCandidates(analysis);

      expect(result.reasoning).toBeTruthy();
      expect(result.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe('Speech content processing', () => {
    test('uses -16 LUFS target for speech', () => {
      const analysis = createMockAnalysis('speech');
      const result = generateCandidates(analysis);

      for (const candidate of result.candidates) {
        expect(candidate.targetLufs).toBe(-16);
      }
    });

    test('uses -1.5 dBTP true peak for speech', () => {
      const analysis = createMockAnalysis('speech');
      const result = generateCandidates(analysis);

      for (const candidate of result.candidates) {
        expect(candidate.targetTruePeak).toBe(-1.5);
      }
    });

    test('uses 80Hz high-pass for speech', () => {
      const analysis = createMockAnalysis('speech');
      const result = generateCandidates(analysis);

      const conservative = result.candidates.find(c => c.name === 'Conservative');
      expect(conservative?.filterChain).toContain('highpass=f=80');
    });

    test('uses dynaudnorm for speech leveling in balanced config', () => {
      const analysis = createMockAnalysis('speech');
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');
      expect(balanced?.filterChain).toContain('dynaudnorm');
      expect(balanced?.filtersApplied.some(f => f.includes('dynaudnorm'))).toBe(true);
    });

    test('applies de-esser when sibilance detected', () => {
      const analysis = createMockAnalysis('speech', {
        sibilance: { detected: true, severity: 'mild' },
      });
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');
      expect(balanced?.filterChain).toContain('deesser');
    });

    test('does not apply compression for speech', () => {
      const analysis = createMockAnalysis('speech');
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');
      // Should use dynaudnorm, NOT acompressor
      expect(balanced?.filterChain).toContain('dynaudnorm');
      expect(balanced?.filterChain).not.toContain('acompressor');
    });
  });

  describe('Music content processing', () => {
    test('uses -14 LUFS target for music', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);

      for (const candidate of result.candidates) {
        expect(candidate.targetLufs).toBe(-14);
      }
    });

    test('uses -1 dBTP true peak for music', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);

      for (const candidate of result.candidates) {
        expect(candidate.targetTruePeak).toBe(-1);
      }
    });

    test('uses 30Hz high-pass for music to preserve bass', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);

      const conservative = result.candidates.find(c => c.name === 'Conservative');
      expect(conservative?.filterChain).toContain('highpass=f=30');
    });

    test('does not use dynaudnorm for music', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);

      // Music-optimized should never use dynaudnorm
      const optimized = result.candidates.find(c => c.name.includes('Music'));
      expect(optimized?.filterChain).not.toContain('dynaudnorm');
    });

    test('does not apply de-esser to music', () => {
      const analysis = createMockAnalysis('music', {
        sibilance: { detected: true, severity: 'mild' },
      });
      const result = generateCandidates(analysis);

      // Music should never have de-esser even if high frequencies detected
      const optimized = result.candidates.find(c => c.name.includes('Music'));
      expect(optimized?.filterChain).not.toContain('deesser');
    });

    test('only applies compression to music if LRA > 20', () => {
      // LRA = 18, should NOT apply compression
      const normalLra = createMockAnalysis('music', {
        loudnessRange: 18,
        excessiveDynamicRange: { detected: false, severity: 'none' },
      });
      const normalResult = generateCandidates(normalLra);
      const normalBalanced = normalResult.candidates.find(c => c.name === 'Balanced');
      expect(normalBalanced?.filterChain).not.toContain('acompressor');

      // LRA = 22, should apply compression
      const highLra = createMockAnalysis('music', {
        loudnessRange: 22,
        excessiveDynamicRange: { detected: true, severity: 'mild' },
      });
      const highResult = generateCandidates(highLra);
      const highBalanced = highResult.candidates.find(c => c.name === 'Balanced');
      expect(highBalanced?.filterChain).toContain('acompressor');
    });

    test('uses gentle compression settings for music (1.5:1 ratio)', () => {
      const analysis = createMockAnalysis('music', {
        loudnessRange: 25,
        excessiveDynamicRange: { detected: true, severity: 'moderate' },
      });
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');
      if (balanced?.filterChain.includes('acompressor')) {
        expect(balanced.filterChain).toContain('ratio=1.5');
      }
    });
  });

  describe('Noise reduction', () => {
    test('applies noise reduction when noise detected', () => {
      const analysis = createMockAnalysis('speech', {
        noiseFloor: { detected: true, severity: 'mild' },
      });
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');
      expect(balanced?.filterChain).toContain('anlmdn');
    });

    test('uses stronger noise reduction for speech than music', () => {
      const speechAnalysis = createMockAnalysis('speech', {
        noiseFloor: { detected: true, severity: 'mild' },
      });
      const musicAnalysis = createMockAnalysis('music', {
        noiseFloor: { detected: true, severity: 'mild' },
      });

      const speechResult = generateCandidates(speechAnalysis);
      const musicResult = generateCandidates(musicAnalysis);

      const speechBalanced = speechResult.candidates.find(c => c.name === 'Balanced');
      const musicBalanced = musicResult.candidates.find(c => c.name === 'Balanced');

      // Speech uses s=7, music uses s=3 or less
      expect(speechBalanced?.filterChain).toContain('anlmdn=s=7');
      expect(musicBalanced?.filterChain).toContain('anlmdn=s=3');
    });

    test('aggressive candidate uses stronger noise reduction', () => {
      const analysis = createMockAnalysis('speech', {
        noiseFloor: { detected: true, severity: 'moderate' },
      });
      const result = generateCandidates(analysis);

      const aggressive = result.candidates.find(c => c.name === 'Aggressive');
      // Aggressive should use s=10 for speech
      expect(aggressive?.filterChain).toContain('anlmdn=s=10');
    });
  });

  describe('Muddiness correction', () => {
    test('applies EQ cut when muddiness detected', () => {
      const analysis = createMockAnalysis('speech', {
        muddiness: { detected: true, severity: 'mild' },
      });
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');
      expect(balanced?.filterChain).toContain('equalizer=f=300');
    });

    test('applies stronger cut for severe muddiness', () => {
      const mildAnalysis = createMockAnalysis('speech', {
        muddiness: { detected: true, severity: 'mild' },
      });
      const severeAnalysis = createMockAnalysis('speech', {
        muddiness: { detected: true, severity: 'severe' },
      });

      const mildResult = generateCandidates(mildAnalysis);
      const severeResult = generateCandidates(severeAnalysis);

      const mildBalanced = mildResult.candidates.find(c => c.name === 'Balanced');
      const severeBalanced = severeResult.candidates.find(c => c.name === 'Balanced');

      // Mild uses -2dB, severe uses -4dB
      expect(mildBalanced?.filterChain).toContain('g=-2');
      expect(severeBalanced?.filterChain).toContain('g=-4');
    });
  });

  describe('Filter chain structure', () => {
    test('filter chain follows correct processing order', () => {
      const analysis = createMockAnalysis('speech', {
        noiseFloor: { detected: true, severity: 'mild' },
        muddiness: { detected: true, severity: 'mild' },
        sibilance: { detected: true, severity: 'mild' },
      });
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');
      const chain = balanced?.filterChain || '';

      // Order should be: highpass -> anlmdn -> equalizer -> deesser -> dynaudnorm -> loudnorm
      const highpassPos = chain.indexOf('highpass');
      const anlmdnPos = chain.indexOf('anlmdn');
      const equalizerPos = chain.indexOf('equalizer');
      const deesserPos = chain.indexOf('deesser');
      const dynaudnormPos = chain.indexOf('dynaudnorm');
      const loudnormPos = chain.indexOf('loudnorm');

      expect(highpassPos).toBeLessThan(anlmdnPos);
      expect(anlmdnPos).toBeLessThan(equalizerPos);
      expect(equalizerPos).toBeLessThan(deesserPos);
      expect(deesserPos).toBeLessThan(dynaudnormPos);
      expect(dynaudnormPos).toBeLessThan(loudnormPos);
    });

    test('loudnorm is always last in chain', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);

      for (const candidate of result.candidates) {
        // loudnorm should be at the end
        expect(candidate.filterChain.endsWith(':linear=true')).toBe(true);
      }
    });

    test('filtersApplied array matches filter chain', () => {
      const analysis = createMockAnalysis('speech', {
        noiseFloor: { detected: true, severity: 'mild' },
      });
      const result = generateCandidates(analysis);

      const balanced = result.candidates.find(c => c.name === 'Balanced');

      // Should have: high-pass, noise reduction, dynaudnorm, loudnorm
      expect(balanced?.filtersApplied.length).toBeGreaterThanOrEqual(4);
      expect(balanced?.filtersApplied.some(f => f.includes('High-pass'))).toBe(true);
      expect(balanced?.filtersApplied.some(f => f.includes('Noise reduction'))).toBe(true);
      expect(balanced?.filtersApplied.some(f => f.includes('dynaudnorm'))).toBe(true);
      expect(balanced?.filtersApplied.some(f => f.includes('Loudness normalization'))).toBe(true);
    });
  });

  describe('getFilterChain', () => {
    test('returns the filter chain string from a candidate', () => {
      const analysis = createMockAnalysis('music');
      const result = generateCandidates(analysis);
      const candidate = result.candidates[0];

      const chain = getFilterChain(candidate);
      expect(chain).toBe(candidate.filterChain);
    });
  });

  describe('Podcast mixed content', () => {
    test('uses speech targets for podcast_mixed', () => {
      const analysis = createMockAnalysis('podcast_mixed');
      const result = generateCandidates(analysis);

      for (const candidate of result.candidates) {
        expect(candidate.targetLufs).toBe(-16);
        expect(candidate.targetTruePeak).toBe(-1.5);
      }
    });

    test('uses compromise high-pass for podcast_mixed', () => {
      const analysis = createMockAnalysis('podcast_mixed');
      const result = generateCandidates(analysis);

      const optimized = result.candidates.find(c => c.name.includes('Optimized'));
      // Should use 60Hz for mixed content (compromise)
      expect(optimized?.filterChain).toContain('highpass=f=60');
    });
  });
});
