import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Mock dependencies BEFORE importing the module that uses them
mock.module('../services/queue', () => ({
  addAudioJob: async () => ({ id: 'test-job' }),
  getJobStatus: async (jobId: string) => {
    if (jobId === 'not-found') return null;
    if (jobId === 'completed-job') {
      return {
        id: 'completed-job',
        state: 'completed',
        progress: 100,
        data: { originalName: 'test.mp3', preset: 'podcast' },
        result: {
          success: true,
          outputPath: '/tmp/test-output.mp3',
          duration: 5.2,
          processingType: 'mastering-pipeline',
        },
      };
    }
    if (jobId === 'active-job') {
      return {
        id: 'active-job',
        state: 'active',
        progress: 50,
        data: { originalName: 'test.mp3', preset: 'streaming' },
      };
    }
    if (jobId === 'failed-job') {
      return {
        id: 'failed-job',
        state: 'failed',
        progress: 25,
        data: { originalName: 'test.mp3', preset: 'streaming' },
        failedReason: 'FFmpeg processing failed',
      };
    }
    return {
      id: jobId,
      state: 'waiting',
      progress: 0,
      data: { originalName: 'test.mp3', preset: 'streaming' },
    };
  },
  canAcceptJob: async () => ({ allowed: true, estimatedWaitTime: 30 }),
  getQueueStatus: async () => ({
    status: 'normal',
    acceptingJobs: true,
    estimatedWaitTime: 30,
    waiting: 5,
    active: 2,
    completed: 100,
    failed: 1,
    delayed: 0,
  }),
}));

mock.module('../services/rateLimit', () => ({
  getRateLimitStatus: async () => ({
    remaining: 8,
    count: 2,
    resetAt: Date.now() + 3600000,
  }),
  getClientIp: () => '127.0.0.1',
}));

mock.module('../services/diskMonitor', () => ({
  hasEnoughSpace: async () => ({ allowed: true }),
}));

mock.module('../middleware/rateLimit', () => ({
  uploadRateLimiter: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// Import after mocks are set up
import { Hono } from 'hono';
import upload from '../routes/upload';

// Create test app with error handling
const app = new Hono();
app.onError((err, c) => {
  const statusCode = (err as { statusCode?: number }).statusCode || 500;
  const code = (err as { code?: string }).code || 'INTERNAL_ERROR';
  return c.json({ error: err.message, code }, statusCode as 400 | 404 | 500);
});
app.route('/api/upload', upload);

describe('Upload API', () => {
  describe('GET /api/upload/rate-limit', () => {
    test('returns rate limit status', async () => {
      const res = await app.request('/api/upload/rate-limit');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('limit');
      expect(body).toHaveProperty('remaining');
      expect(body).toHaveProperty('used');
      expect(body).toHaveProperty('resetAt');
      expect(body).toHaveProperty('windowMs');
      expect(body.limit).toBe(10);
    });
  });

  describe('GET /api/upload/queue-status', () => {
    test('returns queue status', async () => {
      const res = await app.request('/api/upload/queue-status');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('acceptingJobs');
      expect(body).toHaveProperty('estimatedWaitTime');
      expect(body).toHaveProperty('waiting');
      expect(body).toHaveProperty('active');
      expect(body.status).toBe('normal');
      expect(body.acceptingJobs).toBe(true);
    });
  });

  describe('GET /api/upload/job/:id', () => {
    test('returns job status for valid job ID', async () => {
      const res = await app.request('/api/upload/job/test-job-123');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('jobId');
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('progress');
    });

    test('returns 404 for non-existent job', async () => {
      const res = await app.request('/api/upload/job/not-found');
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.code).toBe('JOB_NOT_FOUND');
    });

    test('returns active job with progress', async () => {
      const res = await app.request('/api/upload/job/active-job');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('active');
      expect(body.progress).toBe(50);
    });

    test('returns completed job with result', async () => {
      const res = await app.request('/api/upload/job/completed-job');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('completed');
      expect(body.progress).toBe(100);
      expect(body.result).toHaveProperty('success');
      expect(body.result.success).toBe(true);
      expect(body.result.duration).toBe(5.2);
      expect(body.result.processingType).toBe('mastering-pipeline');
    });

    test('returns failed job with error reason', async () => {
      const res = await app.request('/api/upload/job/failed-job');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('failed');
      expect(body.error).toBe('FFmpeg processing failed');
    });
  });

  describe('POST /api/upload', () => {
    test('rejects request without file', async () => {
      const formData = new FormData();
      formData.append('preset', 'streaming');

      const res = await app.request('/api/upload', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('NO_FILE');
    });

    test('rejects unsupported file extension', async () => {
      const file = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('preset', 'streaming');

      const res = await app.request('/api/upload', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('INVALID_FILE_TYPE');
    });

    test('rejects invalid MIME type', async () => {
      // Create a file with valid extension but wrong content
      const file = new File(['not audio data'], 'fake.mp3', { type: 'audio/mpeg' });
      const formData = new FormData();
      formData.append('file', file);
      formData.append('preset', 'streaming');

      const res = await app.request('/api/upload', {
        method: 'POST',
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('INVALID_FORMAT');
    });
  });
});
