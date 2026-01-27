import { describe, expect, test } from 'bun:test';
import { buildMasteringFilterChain, type MasteringAnalysis } from '../services/masteringProcessor';

describe('Mastering Filter Chain Builder', () => {
  test('enables compression when crest factor > 10 and LRA > 5', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -18,
      lra: 8,
      truePeak: -3,
      rmsDb: -25,
      peakDb: -3,
      crestFactor: 22
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.compressionEnabled).toBe(true);
    expect(result.filterChain).toContain('acompressor');
  });

  test('skips compression when crest factor <= 10', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -14,
      lra: 3,
      truePeak: -1,
      rmsDb: -15,
      peakDb: -6,
      crestFactor: 9
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.compressionEnabled).toBe(false);
    expect(result.filterChain).not.toContain('acompressor');
  });

  test('skips compression when LRA <= 5', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -18,
      lra: 4,
      truePeak: -3,
      rmsDb: -25,
      peakDb: -3,
      crestFactor: 22
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.compressionEnabled).toBe(false);
    expect(result.filterChain).not.toContain('acompressor');
  });

  test('enables saturation when quiet with headroom', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -18,
      lra: 6,
      truePeak: -3,
      rmsDb: -20,
      peakDb: -3,
      crestFactor: 17
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.saturationEnabled).toBe(true);
    expect(result.filterChain).toContain('asoftclip');
  });

  test('skips saturation when already hot (LUFS >= -12)', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -10,
      lra: 4,
      truePeak: -0.5,
      rmsDb: -12,
      peakDb: -1,
      crestFactor: 11
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.saturationEnabled).toBe(false);
    expect(result.filterChain).not.toContain('asoftclip');
  });

  test('skips saturation when true peak too high (>= -1.5)', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -18,
      lra: 6,
      truePeak: -1.0,
      rmsDb: -20,
      peakDb: -1,
      crestFactor: 19
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.saturationEnabled).toBe(false);
    expect(result.filterChain).not.toContain('asoftclip');
  });

  test('always includes highpass, loudnorm, and limiter', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -14,
      lra: 4,
      truePeak: -1,
      rmsDb: -16,
      peakDb: -2,
      crestFactor: 14
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.filterChain).toContain('highpass=f=25');
    expect(result.filterChain).toContain('loudnorm=I=-9');
    expect(result.filterChain).toContain('alimiter');
  });

  test('loudnorm targets -9 LUFS with -1.0 dBTP', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -20,
      lra: 4,
      truePeak: -2,
      rmsDb: -22,
      peakDb: -2,
      crestFactor: 20
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.filterChain).toContain('loudnorm=I=-9:TP=-1.0:LRA=5');
  });

  test('limiter uses 0.93 limit for -0.63 dB headroom', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -16,
      lra: 4,
      truePeak: -2,
      rmsDb: -18,
      peakDb: -2,
      crestFactor: 16
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.filterChain).toContain('alimiter=limit=0.93');
  });

  test('enables both compression and saturation when conditions met', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -20,
      lra: 10,
      truePeak: -3,
      rmsDb: -30,
      peakDb: -3,
      crestFactor: 27
    };

    const result = buildMasteringFilterChain(analysis);
    expect(result.compressionEnabled).toBe(true);
    expect(result.saturationEnabled).toBe(true);
    expect(result.filterChain).toContain('acompressor');
    expect(result.filterChain).toContain('asoftclip');
  });

  test('filter chain order is correct: highpass, [compressor], [saturation], loudnorm, limiter', () => {
    const analysis: MasteringAnalysis = {
      integratedLufs: -20,
      lra: 10,
      truePeak: -3,
      rmsDb: -30,
      peakDb: -3,
      crestFactor: 27
    };

    const result = buildMasteringFilterChain(analysis);
    const chain = result.filterChain;

    // Check order by comparing indices
    const highpassIdx = chain.indexOf('highpass');
    const compressorIdx = chain.indexOf('acompressor');
    const saturationIdx = chain.indexOf('asoftclip');
    const loudnormIdx = chain.indexOf('loudnorm');
    const limiterIdx = chain.indexOf('alimiter');

    expect(highpassIdx).toBeLessThan(compressorIdx);
    expect(compressorIdx).toBeLessThan(saturationIdx);
    expect(saturationIdx).toBeLessThan(loudnormIdx);
    expect(loudnormIdx).toBeLessThan(limiterIdx);
  });
});
