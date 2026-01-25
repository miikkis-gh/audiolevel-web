import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { env } from './config/env';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { getRedisClient, closeRedis } from './services/redis';
import { closeQueue } from './services/queue';
import healthRoutes from './routes/health';
import presetsRoutes from './routes/presets';
import uploadRoutes from './routes/upload';

const app = new Hono();

// Middleware
app.use('*', honoLogger());
app.use('*', errorHandler);
app.use(
  '*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Disposition'],
    maxAge: 86400,
    credentials: true,
  })
);

// Routes
app.route('/api/health', healthRoutes);
app.route('/api/presets', presetsRoutes);
app.route('/api/upload', uploadRoutes);

// Job status route (alias for convenience)
app.get('/api/job/:id', async (c) => {
  const response = await fetch(`http://localhost:${env.PORT}/api/upload/job/${c.req.param('id')}`);
  return response;
});

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'AudioLevel API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      presets: '/api/presets',
      upload: '/api/upload',
      jobStatus: '/api/job/:id',
      download: '/api/job/:id/download',
    },
  });
});

// Initialize Redis connection
getRedisClient();

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  await closeQueue();
  await closeRedis();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Starting AudioLevel server');

export default {
  port: env.PORT,
  fetch: app.fetch,
};
