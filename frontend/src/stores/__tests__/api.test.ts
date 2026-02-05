import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  uploadFile,
  getJobStatus,
  fetchRateLimitStatus,
  fetchQueueStatus,
  getDownloadUrl,
  type RateLimitStatus,
  type QueueStatus,
  type JobStatus,
  type UploadResponse,
  type ApiError,
} from '../api';

describe('API Store', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset();
  });

  describe('uploadFile', () => {
    it('sends FormData correctly and returns job response', async () => {
      const mockResponse: UploadResponse = {
        jobId: 'job-123',
        status: 'queued',
        originalName: 'test.mp3',
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const file = new File(['audio content'], 'test.mp3', { type: 'audio/mpeg' });
      const result = await uploadFile(file);

      expect(fetch).toHaveBeenCalledWith('/api/upload', {
        method: 'POST',
        body: expect.any(FormData),
      });

      // Verify FormData contents
      const call = vi.mocked(fetch).mock.calls[0];
      const formData = call[1]?.body as FormData;
      const uploadedFile = formData.get('file') as File;
      expect(uploadedFile).toBeInstanceOf(File);
      expect(uploadedFile.name).toBe('test.mp3');
      expect(uploadedFile.type).toBe('audio/mpeg');

      expect(result).toEqual(mockResponse);
    });

    it('handles 429 rate limit with retry-after header', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '60' }),
        json: async () => ({ error: 'Rate limit exceeded', code: 'RATE_LIMIT' }),
      } as Response);

      const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' });

      try {
        await uploadFile(file);
        expect.fail('Should have thrown an error');
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(429);
        expect(apiError.retryAfter).toBe(60);
        expect(apiError.message).toBe('Rate limit exceeded');
      }
    });

    it('handles 500 server error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ error: 'Internal server error' }),
      } as Response);

      const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' });

      try {
        await uploadFile(file);
        expect.fail('Should have thrown an error');
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(500);
        expect(apiError.message).toBe('Internal server error');
      }
    });

    it('uses default error message when none provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: async () => ({}),
      } as Response);

      const file = new File(['audio'], 'test.mp3', { type: 'audio/mpeg' });

      try {
        await uploadFile(file);
        expect.fail('Should have thrown an error');
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.status).toBe(503);
        expect(apiError.message).toBe('Service unavailable');
      }
    });
  });

  describe('getJobStatus', () => {
    it('returns job status for valid job ID', async () => {
      const mockStatus: JobStatus = {
        jobId: 'job-123',
        status: 'active',
        progress: 50,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      } as Response);

      const result = await getJobStatus('job-123');

      expect(fetch).toHaveBeenCalledWith('/api/upload/job/job-123');
      expect(result).toEqual(mockStatus);
    });

    it('throws error on 404 (job not found)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      await expect(getJobStatus('nonexistent')).rejects.toThrow('Failed to get job status');
    });

    it('returns completed job with result', async () => {
      const mockStatus: JobStatus = {
        jobId: 'job-123',
        status: 'completed',
        progress: 100,
        result: {
          success: true,
          outputPath: '/output/processed.mp3',
          duration: 5.2,
          inputAnalysis: { inputLufs: -18.5, inputTruePeak: -0.5 },
          outputAnalysis: { inputLufs: -14.0, inputTruePeak: -1.0 },
        },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      } as Response);

      const result = await getJobStatus('job-123');

      expect(result.status).toBe('completed');
      expect(result.result?.success).toBe(true);
    });
  });

  describe('fetchRateLimitStatus', () => {
    it('returns rate limit info', async () => {
      const mockStatus: RateLimitStatus = {
        limit: 10,
        remaining: 7,
        used: 3,
        resetAt: Date.now() + 60000,
        windowMs: 60000,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      } as Response);

      const result = await fetchRateLimitStatus();

      expect(fetch).toHaveBeenCalledWith('/api/upload/rate-limit');
      expect(result).toEqual(mockStatus);
    });

    it('throws error on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(fetchRateLimitStatus()).rejects.toThrow('Failed to fetch rate limit status');
    });
  });

  describe('fetchQueueStatus', () => {
    it('returns queue metrics', async () => {
      const mockStatus: QueueStatus = {
        status: 'normal',
        acceptingJobs: true,
        estimatedWaitTime: 30,
        waiting: 5,
        active: 2,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      } as Response);

      const result = await fetchQueueStatus();

      expect(fetch).toHaveBeenCalledWith('/api/upload/queue-status');
      expect(result).toEqual(mockStatus);
    });

    it('returns warning status when queue is busy', async () => {
      const mockStatus: QueueStatus = {
        status: 'warning',
        acceptingJobs: true,
        estimatedWaitTime: 120,
        waiting: 30,
        active: 4,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      } as Response);

      const result = await fetchQueueStatus();

      expect(result.status).toBe('warning');
      expect(result.acceptingJobs).toBe(true);
    });

    it('returns overloaded status when queue is full', async () => {
      const mockStatus: QueueStatus = {
        status: 'overloaded',
        acceptingJobs: false,
        estimatedWaitTime: 600,
        waiting: 55,
        active: 4,
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => mockStatus,
      } as Response);

      const result = await fetchQueueStatus();

      expect(result.status).toBe('overloaded');
      expect(result.acceptingJobs).toBe(false);
    });

    it('throws error on failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(fetchQueueStatus()).rejects.toThrow('Failed to fetch queue status');
    });
  });

  describe('getDownloadUrl', () => {
    it('constructs correct download URL', () => {
      const url = getDownloadUrl('job-123');
      expect(url).toBe('/api/upload/job/job-123/download');
    });

    it('handles job IDs with special characters', () => {
      const url = getDownloadUrl('job-abc-123-xyz');
      expect(url).toBe('/api/upload/job/job-abc-123-xyz/download');
    });
  });
});
