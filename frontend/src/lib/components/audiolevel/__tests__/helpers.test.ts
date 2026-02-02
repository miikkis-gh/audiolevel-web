import { describe, it, expect } from 'vitest';
import {
  getStageLabel,
  getLayout,
  getPositions,
  truncName,
  profileCSS,
} from '../helpers';
import { STAGES, PROFILE_COLORS } from '../constants';

describe('Helper Functions', () => {
  describe('getStageLabel', () => {
    it('returns first stage label for 0%', () => {
      expect(getStageLabel(0)).toBe('Reading metadata');
    });

    it('returns correct stage for each threshold', () => {
      expect(getStageLabel(0)).toBe('Reading metadata');
      expect(getStageLabel(18)).toBe('Analyzing loudness');
      expect(getStageLabel(38)).toBe('Detecting silence');
      expect(getStageLabel(55)).toBe('Classifying content');
      expect(getStageLabel(70)).toBe('Normalizing audio');
      expect(getStageLabel(90)).toBe('Verifying output');
    });

    it('returns previous stage for values between thresholds', () => {
      expect(getStageLabel(10)).toBe('Reading metadata');
      expect(getStageLabel(25)).toBe('Analyzing loudness');
      expect(getStageLabel(50)).toBe('Detecting silence');
      expect(getStageLabel(65)).toBe('Classifying content');
      expect(getStageLabel(85)).toBe('Normalizing audio');
    });

    it('returns last stage for 100%', () => {
      expect(getStageLabel(100)).toBe('Verifying output');
    });

    it('returns last stage for values above 100', () => {
      expect(getStageLabel(150)).toBe('Verifying output');
    });

    it('handles all defined stages', () => {
      for (const stage of STAGES) {
        expect(getStageLabel(stage.at)).toBe(stage.label);
      }
    });
  });

  describe('getLayout', () => {
    it('returns largest size for 1-2 items', () => {
      expect(getLayout(1)).toEqual({ size: 76, radius: 80 });
      expect(getLayout(2)).toEqual({ size: 76, radius: 80 });
    });

    it('returns correct layout for 3-4 items', () => {
      expect(getLayout(3)).toEqual({ size: 64, radius: 95 });
      expect(getLayout(4)).toEqual({ size: 64, radius: 95 });
    });

    it('returns correct layout for 5-6 items', () => {
      expect(getLayout(5)).toEqual({ size: 56, radius: 110 });
      expect(getLayout(6)).toEqual({ size: 56, radius: 110 });
    });

    it('returns correct layout for 7-8 items', () => {
      expect(getLayout(7)).toEqual({ size: 50, radius: 125 });
      expect(getLayout(8)).toEqual({ size: 50, radius: 125 });
    });

    it('returns correct layout for 9-10 items', () => {
      expect(getLayout(9)).toEqual({ size: 46, radius: 140 });
      expect(getLayout(10)).toEqual({ size: 46, radius: 140 });
    });

    it('returns correct layout for 11-14 items', () => {
      expect(getLayout(11)).toEqual({ size: 40, radius: 160 });
      expect(getLayout(14)).toEqual({ size: 40, radius: 160 });
    });

    it('returns smallest size for 15+ items', () => {
      expect(getLayout(15)).toEqual({ size: 36, radius: 180 });
      expect(getLayout(20)).toEqual({ size: 36, radius: 180 });
      expect(getLayout(100)).toEqual({ size: 36, radius: 180 });
    });

    it('handles edge case of 0 items', () => {
      expect(getLayout(0)).toEqual({ size: 76, radius: 80 });
    });
  });

  describe('getPositions', () => {
    it('returns correct positions for 1 item', () => {
      const positions = getPositions(1, 100);
      expect(positions).toHaveLength(1);
      // With count <= 2, start angle is 0, so first position is at (radius, 0)
      expect(positions[0].x).toBeCloseTo(100);
      expect(positions[0].y).toBeCloseTo(0);
    });

    it('returns correct positions for 2 items', () => {
      const positions = getPositions(2, 100);
      expect(positions).toHaveLength(2);
      // First at 0 radians, second at PI radians
      expect(positions[0].x).toBeCloseTo(100);
      expect(positions[0].y).toBeCloseTo(0);
      expect(positions[1].x).toBeCloseTo(-100);
      expect(positions[1].y).toBeCloseTo(0, 5);
    });

    it('returns correct positions for 4 items', () => {
      const positions = getPositions(4, 100);
      expect(positions).toHaveLength(4);
      // With count > 2, start angle is -PI/2 (top)
      // Position 0: top (0, -100)
      expect(positions[0].x).toBeCloseTo(0, 5);
      expect(positions[0].y).toBeCloseTo(-100);
      // Position 1: right (100, 0)
      expect(positions[1].x).toBeCloseTo(100);
      expect(positions[1].y).toBeCloseTo(0, 5);
      // Position 2: bottom (0, 100)
      expect(positions[2].x).toBeCloseTo(0, 5);
      expect(positions[2].y).toBeCloseTo(100);
      // Position 3: left (-100, 0)
      expect(positions[3].x).toBeCloseTo(-100);
      expect(positions[3].y).toBeCloseTo(0, 5);
    });

    it('distributes positions evenly around circle', () => {
      const count = 6;
      const radius = 100;
      const positions = getPositions(count, radius);

      // All positions should be at the specified radius from origin
      for (const pos of positions) {
        const distance = Math.sqrt(pos.x ** 2 + pos.y ** 2);
        expect(distance).toBeCloseTo(radius);
      }
    });

    it('handles empty array for 0 items', () => {
      const positions = getPositions(0, 100);
      expect(positions).toHaveLength(0);
    });
  });

  describe('truncName', () => {
    it('returns full base name if shorter than max', () => {
      expect(truncName('short.mp3')).toBe('short');
      expect(truncName('test.wav')).toBe('test');
    });

    it('removes file extension', () => {
      expect(truncName('filename.mp3')).toBe('filename');
      expect(truncName('audio.file.wav')).toBe('audio.file');
      expect(truncName('no-extension')).toBe('no-extension');
    });

    it('truncates long names with ellipsis', () => {
      expect(truncName('verylongfilename.mp3')).toBe('verylongfil\u2026');
      expect(truncName('this-is-a-very-long-filename.wav')).toBe('this-is-a-v\u2026');
    });

    it('respects custom max length', () => {
      expect(truncName('filename.mp3', 5)).toBe('file\u2026');
      expect(truncName('filename.mp3', 7)).toBe('filena\u2026');
      expect(truncName('filename.mp3', 8)).toBe('filename'); // 8 chars = 8 max, no truncation
      expect(truncName('filename.mp3', 20)).toBe('filename');
    });

    it('handles names exactly at max length', () => {
      expect(truncName('twelve_char.mp3', 11)).toBe('twelve_char'); // 11 chars <= 11 max
      expect(truncName('twelve_char.mp3', 10)).toBe('twelve_ch\u2026'); // 11 chars > 10, truncate to 9 + ellipsis
    });

    it('handles names with multiple dots', () => {
      expect(truncName('file.name.with.dots.mp3')).toBe('file.name.w\u2026');
    });

    it('handles empty string', () => {
      expect(truncName('')).toBe('');
    });

    it('handles name with only extension', () => {
      expect(truncName('.gitignore')).toBe('');
    });
  });

  describe('profileCSS', () => {
    it('returns correct CSS for Music / Song', () => {
      const css = profileCSS('Music / Song');
      const [r, g, b] = PROFILE_COLORS['Music / Song'];

      expect(css.badge.color).toBe(`rgba(${r},${g},${b},.9)`);
      expect(css.badge.background).toBe(`rgba(${r},${g},${b},.08)`);
      expect(css.badge.border).toBe(`1px solid rgba(${r},${g},${b},.15)`);
      expect(css.conf.color).toBe(`rgba(${r},${g},${b},.5)`);
      expect(css.after.color).toBe(`rgba(${r},${g},${b},.8)`);
      expect(css.chevron.color).toBe(`rgba(${r},${g},${b},.3)`);
    });

    it('returns correct CSS for all known profile types', () => {
      const types = Object.keys(PROFILE_COLORS);

      for (const type of types) {
        const css = profileCSS(type);
        const [r, g, b] = PROFILE_COLORS[type];

        expect(css.badge.color).toContain(`${r},${g},${b}`);
        expect(css.conf.color).toContain(`${r},${g},${b}`);
      }
    });

    it('returns default color for unknown profile type', () => {
      const css = profileCSS('Unknown Type');
      // Default is [80, 210, 180]
      expect(css.badge.color).toBe('rgba(80,210,180,.9)');
    });

    it('returns all required CSS properties', () => {
      const css = profileCSS('Podcast / Talk');

      expect(css).toHaveProperty('badge');
      expect(css).toHaveProperty('conf');
      expect(css).toHaveProperty('after');
      expect(css).toHaveProperty('chevron');

      expect(css.badge).toHaveProperty('color');
      expect(css.badge).toHaveProperty('background');
      expect(css.badge).toHaveProperty('border');
    });
  });
});
