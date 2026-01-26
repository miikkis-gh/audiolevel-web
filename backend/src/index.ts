import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { env } from './config/env';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
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
  fetch(req: Request, server: import('bun').Server) {
    // Handle WebSocket upgrade
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req, {
        data: {
          sessionId: '',
          subscribedJobs: new Set<string>(),
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
