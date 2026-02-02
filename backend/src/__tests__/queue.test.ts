import { describe, expect, test } from 'bun:test';
import {
  calculatePriority,
  JobPriority,
  QUEUE_THRESHOLDS,
} from '../services/queue';

describe('Queue Service', () => {
  describe('calculatePriority', () => {
    test('returns NORMAL for undefined file size', () => {
      expect(calculatePriority(undefined)).toBe(JobPriority.NORMAL);
    });

    test('returns HIGH for files under 5MB', () => {
      const sizes = [
        1024, // 1KB
        1024 * 1024, // 1MB
        4 * 1024 * 1024, // 4MB
        4.99 * 1024 * 1024, // 4.99MB
      ];

      for (const size of sizes) {
        expect(calculatePriority(size)).toBe(JobPriority.HIGH);
      }
    });

    test('returns NORMAL for files 5-25MB', () => {
      const sizes = [
        5 * 1024 * 1024, // 5MB exactly
        10 * 1024 * 1024, // 10MB
        20 * 1024 * 1024, // 20MB
        24.99 * 1024 * 1024, // 24.99MB
      ];

      for (const size of sizes) {
        expect(calculatePriority(size)).toBe(JobPriority.NORMAL);
      }
    });

    test('returns LOW for files 25-50MB', () => {
      const sizes = [
        25 * 1024 * 1024, // 25MB exactly
        30 * 1024 * 1024, // 30MB
        40 * 1024 * 1024, // 40MB
        49.99 * 1024 * 1024, // 49.99MB
      ];

      for (const size of sizes) {
        expect(calculatePriority(size)).toBe(JobPriority.LOW);
      }
    });

    test('returns LOWEST for files over 50MB', () => {
      const sizes = [
        50 * 1024 * 1024, // 50MB exactly
        100 * 1024 * 1024, // 100MB
        500 * 1024 * 1024, // 500MB
      ];

      for (const size of sizes) {
        expect(calculatePriority(size)).toBe(JobPriority.LOWEST);
      }
    });

    test('priority values are correct (lower number = higher priority)', () => {
      expect(JobPriority.HIGH).toBeLessThan(JobPriority.NORMAL);
      expect(JobPriority.NORMAL).toBeLessThan(JobPriority.LOW);
      expect(JobPriority.LOW).toBeLessThan(JobPriority.LOWEST);
    });
  });

  describe('QUEUE_THRESHOLDS', () => {
    test('thresholds are defined correctly', () => {
      expect(QUEUE_THRESHOLDS.NORMAL).toBe(10);
      expect(QUEUE_THRESHOLDS.WARNING).toBe(25);
      expect(QUEUE_THRESHOLDS.OVERLOADED).toBe(50);
    });

    test('thresholds are in ascending order', () => {
      expect(QUEUE_THRESHOLDS.NORMAL).toBeLessThan(QUEUE_THRESHOLDS.WARNING);
      expect(QUEUE_THRESHOLDS.WARNING).toBeLessThan(QUEUE_THRESHOLDS.OVERLOADED);
    });
  });

  describe('JobPriority enum', () => {
    test('priority values are correct', () => {
      expect(JobPriority.HIGH).toBe(1);
      expect(JobPriority.NORMAL).toBe(5);
      expect(JobPriority.LOW).toBe(10);
      expect(JobPriority.LOWEST).toBe(15);
    });
  });
});
