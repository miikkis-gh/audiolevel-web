import { Hono } from 'hono';
import { getActivityStats } from '../services/activityStats';
import { getConnectionStats } from '../websocket/handler';
import { logger } from '../utils/logger';

const app = new Hono();

/**
 * GET /api/stats
 * Returns aggregate activity statistics
 */
app.get('/', async (c) => {
  try {
    const stats = await getActivityStats();
    const wsStats = getConnectionStats();

    return c.json({
      success: true,
      stats: {
        ...stats,
        activeUsers: wsStats.activitySubscribers,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get activity stats');
    return c.json({ success: false, error: 'Failed to get stats' }, 500);
  }
});

export default app;
