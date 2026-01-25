import { Hono } from 'hono';
import { checkRedisHealth } from '../services/redis';
import { getAudioQueue, getQueueHealth, getQueueStatus } from '../services/queue';
import { getWorkerStatus } from '../workers/audioWorker';
import { verifyDependencies } from '../services/audioProcessor';
import { getDiskStatus, formatBytes } from '../services/diskMonitor';
import { getCleanupStats } from '../services/cleanup';
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
    const queueHealth = await getQueueHealth();
    const queueStatus = await getQueueStatus();

    // Log alerts if there are issues
    if (!queueHealth.healthy) {
      logger.warn(
        { issues: queueHealth.issues, metrics: queueHealth.metrics },
        'Queue health check: issues detected'
      );
    }

    return c.json(
      {
        healthy: queueHealth.healthy,
        status: queueStatus.status,
        acceptingJobs: queueStatus.acceptingJobs,
        issues: queueHealth.issues,
        counts: {
          waiting: queueStatus.waiting,
          active: queueStatus.active,
          completed: queueStatus.completed,
          failed: queueStatus.failed,
          delayed: queueStatus.delayed,
        },
        estimatedWaitTime: queueStatus.estimatedWaitTime,
      },
      queueHealth.healthy ? 200 : 503
    );
  } catch {
    return c.json({ status: 'error', message: 'Queue not available' }, 503);
  }
});

health.get('/disk', async (c) => {
  const diskStatus = await getDiskStatus();

  return c.json(
    {
      status: diskStatus.status,
      message: diskStatus.message,
      disk: {
        total: formatBytes(diskStatus.usage.total),
        free: formatBytes(diskStatus.usage.free),
        used: formatBytes(diskStatus.usage.used),
        usedPercent: `${diskStatus.usage.usedPercent.toFixed(1)}%`,
      },
    },
    diskStatus.status === 'critical' ? 503 : 200
  );
});

health.get('/storage', async (c) => {
  const stats = await getCleanupStats();

  return c.json({
    uploads: {
      files: stats.uploads.count,
      size: formatBytes(stats.uploads.totalSize),
      sizeBytes: stats.uploads.totalSize,
    },
    outputs: {
      files: stats.outputs.count,
      size: formatBytes(stats.outputs.totalSize),
      sizeBytes: stats.outputs.totalSize,
    },
    total: {
      files: stats.uploads.count + stats.outputs.count,
      size: formatBytes(stats.uploads.totalSize + stats.outputs.totalSize),
      sizeBytes: stats.uploads.totalSize + stats.outputs.totalSize,
    },
  });
});

// Comprehensive health summary with all checks
health.get('/summary', async (c) => {
  const [redisHealthy, workerStatus, queueHealth, diskStatus, deps] = await Promise.all([
    checkRedisHealth(),
    Promise.resolve(getWorkerStatus()),
    getQueueHealth(),
    getDiskStatus(),
    verifyDependencies(),
  ]);

  const alerts: string[] = [];
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

  // Check Redis
  if (!redisHealthy) {
    alerts.push('Redis is down');
    overallStatus = 'unhealthy';
  }

  // Check worker
  if (!workerStatus.running) {
    alerts.push('Audio worker is not running');
    overallStatus = 'unhealthy';
  }

  // Check queue
  if (!queueHealth.healthy) {
    alerts.push(...queueHealth.issues);
    if (overallStatus === 'healthy') overallStatus = 'degraded';
  }

  // Check disk
  if (diskStatus.status === 'critical') {
    alerts.push('Disk space critical');
    overallStatus = 'unhealthy';
  } else if (diskStatus.status === 'warning') {
    alerts.push('Disk space low');
    if (overallStatus === 'healthy') overallStatus = 'degraded';
  }

  // Check dependencies
  if (!deps.ffmpeg || !deps.ffprobe || !deps.ffmpegNormalize) {
    alerts.push('Missing audio processing dependencies');
    overallStatus = 'unhealthy';
  }

  // Log alerts
  if (alerts.length > 0) {
    logger.warn({ alerts, overallStatus }, 'Health summary: issues detected');
  }

  return c.json(
    {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      alerts,
      services: {
        redis: redisHealthy,
        worker: workerStatus.running,
        queue: queueHealth.healthy,
        disk: diskStatus.status !== 'critical',
        dependencies: deps.ffmpeg && deps.ffprobe && deps.ffmpegNormalize,
      },
      queue: {
        status: queueHealth.metrics.status,
        waiting: queueHealth.metrics.waiting,
        active: queueHealth.metrics.active,
        acceptingJobs: queueHealth.metrics.acceptingJobs,
      },
      disk: {
        status: diskStatus.status,
        usedPercent: diskStatus.usage.usedPercent,
        freeBytes: diskStatus.usage.free,
      },
    },
    overallStatus === 'unhealthy' ? 503 : 200
  );
});

export default health;
