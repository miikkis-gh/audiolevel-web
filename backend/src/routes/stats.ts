import { Hono } from 'hono';
import { getActivityStats } from '../services/activityStats';
import { getConnectionStats } from '../websocket/handler';
import { getGenreStats, recordGenreConfirmation, getGenreGuess } from '../services/genreStats';
import { BROAD_GENRES, GENRE_SUBCATEGORIES } from '../services/genreHeuristics';
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

/**
 * GET /api/stats/genres
 * Returns genre statistics
 */
app.get('/genres', async (c) => {
  try {
    const stats = await getGenreStats();

    return c.json({
      success: true,
      stats,
      categories: {
        broad: BROAD_GENRES,
        subcategories: GENRE_SUBCATEGORIES,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get genre stats');
    return c.json({ success: false, error: 'Failed to get genre stats' }, 500);
  }
});

/**
 * GET /api/stats/genres/:jobId
 * Returns genre guess for a specific job
 */
app.get('/genres/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const guess = await getGenreGuess(jobId);

    if (!guess) {
      return c.json({ success: false, error: 'Genre data not found' }, 404);
    }

    return c.json({
      success: true,
      genre: guess,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to get genre guess');
    return c.json({ success: false, error: 'Failed to get genre data' }, 500);
  }
});

/**
 * POST /api/stats/genres/confirm
 * Records a user's genre confirmation
 */
app.post('/genres/confirm', async (c) => {
  try {
    const body = await c.req.json();
    const { jobId, broad, detailed } = body;

    if (!jobId || !broad) {
      return c.json({ success: false, error: 'Missing jobId or broad genre' }, 400);
    }

    // Validate broad genre
    if (!BROAD_GENRES.includes(broad)) {
      return c.json({ success: false, error: 'Invalid broad genre' }, 400);
    }

    // Validate detailed genre if provided
    if (detailed) {
      const validSubcategories = Object.values(GENRE_SUBCATEGORIES).flat();
      if (!validSubcategories.includes(detailed)) {
        return c.json({ success: false, error: 'Invalid detailed genre' }, 400);
      }
    }

    await recordGenreConfirmation(jobId, broad, detailed);

    return c.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Failed to record genre confirmation');
    return c.json({ success: false, error: 'Failed to record genre' }, 500);
  }
});

export default app;
