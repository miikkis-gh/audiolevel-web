import { Hono } from 'hono';
import { checkRedisHealth } from '../services/redis';
import { getAudioQueue } from '../services/queue';
import { getWorkerStatus } from '../workers/audioWorker';
import { verifyDependencies } from '../services/audioProcessor';
import { logger } from '../utils/logger';

const health = new Hono();

health.get('/', async (c) => {
  const redisHealthy = await checkRedisHealth();
  const workerStatus = getWorkerStatus();

  const status = {
    status: redisHealthy && workerStatus.running ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      redis: redisHealthy ? 'up' : 'down',
      worker: workerStatus.running ? 'up' : 'down',
    },
    worker: {
      running: workerStatus.running,
      concurrency: workerStatus.concurrency,
    },
  };

  if (!redisHealthy) {
    logger.warn('Health check: Redis is down');
    return c.json(status, 503);
  }

  return c.json(status);
});

health.get('/ready', async (c) => {
  const redisHealthy = await checkRedisHealth();

  if (!redisHealthy) {
    return c.json({ ready: false, reason: 'Redis not available' }, 503);
  }

  try {
    const queue = getAudioQueue();
    const isPaused = await queue.isPaused();

    return c.json({
      ready: !isPaused,
      reason: isPaused ? 'Queue is paused' : undefined,
    });
  } catch {
    return c.json({ ready: false, reason: 'Queue not available' }, 503);
  }
});

health.get('/dependencies', async (c) => {
  const deps = await verifyDependencies();

  const allAvailable = deps.ffmpeg && deps.ffprobe && deps.ffmpegNormalize;

  return c.json(
    {
      status: allAvailable ? 'ok' : 'missing',
      dependencies: {
        ffmpeg: deps.ffmpeg ? 'available' : 'missing',
        ffprobe: deps.ffprobe ? 'available' : 'missing',
        'ffmpeg-normalize': deps.ffmpegNormalize ? 'available' : 'missing',
      },
    },
    allAvailable ? 200 : 503
  );
});

health.get('/queue', async (c) => {
  try {
    const queue = getAudioQueue();

    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);

    return c.json({
      status: 'ok',
      counts: {
        waiting,
        active,
        completed,
        failed,
      },
    });
  } catch {
    return c.json({ status: 'error', message: 'Queue not available' }, 503);
  }
});

export default health;
