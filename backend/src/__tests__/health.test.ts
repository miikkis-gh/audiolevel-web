import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import health from '../routes/health';

// Create a test app with health routes
const app = new Hono();
app.route('/api/health', health);

describe('Health API', () => {
  test('GET /api/health returns health status', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('services');
  });

  test('GET /api/health/ready returns readiness status', async () => {
    const res = await app.request('/api/health/ready');
    // May return 503 if Redis is not available in test
    expect([200, 503]).toContain(res.status);

    const body = await res.json();
    expect(body).toHaveProperty('ready');
  });

  test('GET /api/health/dependencies returns dependency status', async () => {
    const res = await app.request('/api/health/dependencies');
    // May return 503 if dependencies are missing
    expect([200, 503]).toContain(res.status);

    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('dependencies');
    expect(body.dependencies).toHaveProperty('ffmpeg');
    expect(body.dependencies).toHaveProperty('ffprobe');
    expect(body.dependencies).toHaveProperty('ffmpeg-normalize');
  });

  test('GET /api/health/storage returns storage stats', async () => {
    const res = await app.request('/api/health/storage');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('uploads');
    expect(body).toHaveProperty('outputs');
    expect(body).toHaveProperty('total');
    expect(body.uploads).toHaveProperty('files');
    expect(body.uploads).toHaveProperty('size');
  });

  test('GET /api/health/disk returns disk status', async () => {
    const res = await app.request('/api/health/disk');
    // May return 503 if disk is critical
    expect([200, 503]).toContain(res.status);

    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('disk');
    expect(body.disk).toHaveProperty('total');
    expect(body.disk).toHaveProperty('free');
    expect(body.disk).toHaveProperty('used');
    expect(body.disk).toHaveProperty('usedPercent');
  });
});
