import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { env } from './config/env';
import { logger } from './utils/logger';
import { getRedisClient, closeRedis } from './services/redis';
import { closeQueue } from './services/queue';
import { startAudioWorker, stopAudioWorker } from './workers/audioWorker';
import { startCleanupJob, stopCleanupJob } from './services/cleanup';
import {
  handleOpen,
  handleMessage,
  handleClose,
  handleError,
  startHeartbeat,
  stopHeartbeat,
  closeAllConnections,
  type WebSocketData,
} from './websocket/handler';
import healthRoutes from './routes/health';
import uploadRoutes from './routes/upload';
import statsRoutes from './routes/stats';
import { checkVisqolAvailability } from './services/audioEvaluator';

import { AppError, ERROR_MESSAGES } from './middleware/errorHandler';

const app = new Hono();

// Global error handler (catches all errors)
app.onError((err, c) => {
  if (err instanceof AppError) {
    logger.warn({ err, statusCode: err.statusCode, code: err.code }, 'Application error');
    return c.json(
      {
        error: err.message,
        code: err.code,
        hint: err.hint,
      },
      err.statusCode as 400 | 401 | 403 | 404 | 429 | 500 | 503
    );
  }

  logger.error({ err }, 'Unhandled error');
  return c.json(
    {
      error: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
      hint: 'Please try again. If the problem persists, contact support.',
    },
    500
  );
});

// Middleware
app.use('*', honoLogger());
// Parse allowed CORS origins from environment
const allowedOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : [];

app.use(
  '*',
  cors({
    origin: (origin) => {
      // Allow localhost for development
      if (origin?.includes('localhost')) return origin;
      // If whitelist is configured, only allow those origins
      if (allowedOrigins.length > 0) {
        return allowedOrigins.includes(origin || '') ? origin : null;
      }
      // Fallback: allow origin (requests go through reverse proxy)
      return origin || null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Disposition'],
    maxAge: 86400,
    credentials: true,
  })
);

// Routes
app.route('/api/health', healthRoutes);
app.route('/api/upload', uploadRoutes);
app.route('/api/stats', statsRoutes);

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
      upload: '/api/upload',
      stats: '/api/stats',
      jobStatus: '/api/job/:id',
      download: '/api/job/:id/download',
      websocket: '/ws',
    },
  });
});

// Initialize services
async function initializeServices() {
  // Initialize Redis connection
  getRedisClient();

  // Pre-check ViSQOL availability (caches result for later use)
  await checkVisqolAvailability();

  // Start the audio processing worker
  await startAudioWorker();

  // Start the file cleanup job
  startCleanupJob();

  // Start WebSocket heartbeat monitoring
  startHeartbeat();

  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'AudioLevel server initialized');
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutdown signal received');
  stopHeartbeat();
  closeAllConnections();
  stopCleanupJob();
  await stopAudioWorker();
  await closeQueue();
  await closeRedis();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server and services
initializeServices().catch((err) => {
  logger.error({ err }, 'Failed to initialize services');
  process.exit(1);
});

// Export server configuration with WebSocket support
export default {
  port: env.PORT,
  fetch(req: Request, server: import('bun').Server<WebSocketData>) {
    // Handle WebSocket upgrade
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req, {
        data: {
          sessionId: '',
          subscribedJobs: new Set<string>(),
          subscribedActivity: false,
          lastPing: Date.now(),
        },
      });
      if (upgraded) {
        return undefined;
      }
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Handle regular HTTP requests via Hono
    return app.fetch(req);
  },
  websocket: {
    open(ws: import('bun').ServerWebSocket<WebSocketData>) {
      handleOpen(ws);
    },
    message(ws: import('bun').ServerWebSocket<WebSocketData>, message: string | Buffer) {
      handleMessage(ws, message);
    },
    close(ws: import('bun').ServerWebSocket<WebSocketData>) {
      handleClose(ws);
    },
    error(ws: import('bun').ServerWebSocket<WebSocketData>, error: Error) {
      handleError(ws, error);
    },
  },
};
