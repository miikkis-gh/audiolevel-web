import { Hono } from 'hono';
import { checkRedisHealth } from '../services/redis';
import { getAudioQueue } from '../services/queue';
import { logger } from '../utils/logger';

const health = new Hono();

health.get('/', async (c) => {
  const redisHealthy = await checkRedisHealth();

  const status = {
    status: redisHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      redis: redisHealthy ? 'up' : 'down',
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

export default health;
