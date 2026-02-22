import { mkdirSync, existsSync } from 'fs';
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
import { notifyServerError, notifyServerStart } from './services/discordNotifier';

import { AppError, ERROR_MESSAGES } from './middleware/errorHandler';

// Ensure data directory exists for estimator
const dataDir = 'data';
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

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

  // Send Discord notification for unhandled errors (fire-and-forget)
  notifyServerError(err, {
    endpoint: c.req.path,
    method: c.req.method,
  });

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
    origin: (origin, c) => {
      // Allow localhost for development
      if (origin?.includes('localhost')) return origin;
      // If whitelist is configured, only allow those origins
      if (allowedOrigins.length > 0) {
        return allowedOrigins.includes(origin || '') ? origin : null;
      }
      // Same-origin check: allow if origin hostname matches the Host header
      if (origin) {
        const host = c.req.header('host');
        if (host) {
          try {
            const originHost = new URL(origin).hostname;
            if (originHost === host || originHost === host.split(':')[0]) return origin;
          } catch {}
        }
      }
      // In production without CORS_ORIGINS, reject unknown origins
      if (env.NODE_ENV === 'production') {
        return null;
      }
      // Development fallback: allow any origin
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
app.get('/api/job/:id', (c) => {
  return c.redirect(`/api/upload/job/${c.req.param('id')}`);
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

  // Start the audio processing worker
  await startAudioWorker();

  // Start the file cleanup job
  startCleanupJob();

  // Start WebSocket heartbeat monitoring
  startHeartbeat();

  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'AudioLevel server initialized');

  // Send Discord notification on startup (useful for monitoring restarts)
  await notifyServerStart();
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

/**
 * Validate WebSocket origin against allowed origins.
 * Reuses the same allowedOrigins list as the CORS middleware.
 */
function isWebSocketOriginAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');

  // Allow connections with no origin (non-browser clients, same-origin)
  if (!origin) return true;

  // Allow localhost in any environment
  if (origin.includes('localhost')) return true;

  // If whitelist is configured, check against it
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(origin);
  }

  // Same-origin check: allow if origin hostname matches the Host header
  const host = req.headers.get('host');
  if (host) {
    try {
      const originHost = new URL(origin).hostname;
      if (originHost === host || originHost === host.split(':')[0]) return true;
    } catch {}
  }

  // In production without CORS_ORIGINS, reject unknown origins
  if (env.NODE_ENV === 'production') {
    return false;
  }

  // Development fallback: allow any origin
  return true;
}

// Export server configuration with WebSocket support
export default {
  port: env.PORT,
  fetch(req: Request, server: import('bun').Server<WebSocketData>) {
    // Handle WebSocket upgrade
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      // Validate origin before accepting the upgrade
      if (!isWebSocketOriginAllowed(req)) {
        logger.warn({ origin: req.headers.get('origin') }, 'WebSocket upgrade rejected: origin not allowed');
        return new Response('Forbidden', { status: 403 });
      }

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
