import type { ServerWebSocket } from 'bun';
import { logger, createChildLogger } from '../utils/logger';
import {
  clientMessageSchema,
  createPongMessage,
  createSubscribedMessage,
  createUnsubscribedMessage,
  createErrorMessage,
  type ServerMessage,
  type ClientMessage,
} from './types';

export interface WebSocketData {
  sessionId: string;
  subscribedJobs: Set<string>;
  lastPing: number;
}

// Connection store: sessionId -> WebSocket
const connections = new Map<string, ServerWebSocket<WebSocketData>>();

// Job subscriptions: jobId -> Set of sessionIds
const jobSubscriptions = new Map<string, Set<string>>();

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 60000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Handle new WebSocket connection
 */
export function handleOpen(ws: ServerWebSocket<WebSocketData>): void {
  const sessionId = generateSessionId();
  ws.data = {
    sessionId,
    subscribedJobs: new Set(),
    lastPing: Date.now(),
  };

  connections.set(sessionId, ws);
  logger.info({ sessionId, totalConnections: connections.size }, 'WebSocket connected');
}

/**
 * Handle WebSocket message
 */
export function handleMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: string | Buffer
): void {
  const log = createChildLogger({ sessionId: ws.data.sessionId });

  try {
    const data = typeof message === 'string' ? message : message.toString();
    const parsed = JSON.parse(data);
    const result = clientMessageSchema.safeParse(parsed);

    if (!result.success) {
      log.warn({ error: result.error.message }, 'Invalid WebSocket message');
      sendMessage(ws, createErrorMessage('', 'Invalid message format', 'INVALID_MESSAGE'));
      return;
    }

    const msg = result.data;

    switch (msg.type) {
      case 'subscribe':
        handleSubscribe(ws, msg.jobId);
        break;
      case 'unsubscribe':
        handleUnsubscribe(ws, msg.jobId);
        break;
      case 'ping':
        ws.data.lastPing = Date.now();
        sendMessage(ws, createPongMessage());
        break;
    }
  } catch (err) {
    log.error({ err }, 'Error handling WebSocket message');
    sendMessage(ws, createErrorMessage('', 'Failed to process message', 'PROCESSING_ERROR'));
  }
}

/**
 * Handle subscribe request
 */
function handleSubscribe(ws: ServerWebSocket<WebSocketData>, jobId: string): void {
  const log = createChildLogger({ sessionId: ws.data.sessionId, jobId });

  // Add to client's subscribed jobs
  ws.data.subscribedJobs.add(jobId);

  // Add to job subscriptions map
  if (!jobSubscriptions.has(jobId)) {
    jobSubscriptions.set(jobId, new Set());
  }
  jobSubscriptions.get(jobId)!.add(ws.data.sessionId);

  log.debug('Client subscribed to job');
  sendMessage(ws, createSubscribedMessage(jobId));
}

/**
 * Handle unsubscribe request
 */
function handleUnsubscribe(ws: ServerWebSocket<WebSocketData>, jobId: string): void {
  const log = createChildLogger({ sessionId: ws.data.sessionId, jobId });

  // Remove from client's subscribed jobs
  ws.data.subscribedJobs.delete(jobId);

  // Remove from job subscriptions map
  const subscribers = jobSubscriptions.get(jobId);
  if (subscribers) {
    subscribers.delete(ws.data.sessionId);
    if (subscribers.size === 0) {
      jobSubscriptions.delete(jobId);
    }
  }

  log.debug('Client unsubscribed from job');
  sendMessage(ws, createUnsubscribedMessage(jobId));
}

/**
 * Handle WebSocket close
 */
export function handleClose(ws: ServerWebSocket<WebSocketData>): void {
  const { sessionId, subscribedJobs } = ws.data;

  // Clean up all job subscriptions for this session
  for (const jobId of subscribedJobs) {
    const subscribers = jobSubscriptions.get(jobId);
    if (subscribers) {
      subscribers.delete(sessionId);
      if (subscribers.size === 0) {
        jobSubscriptions.delete(jobId);
      }
    }
  }

  // Remove from connections
  connections.delete(sessionId);

  logger.info({ sessionId, totalConnections: connections.size }, 'WebSocket disconnected');
}

/**
 * Handle WebSocket error
 */
export function handleError(ws: ServerWebSocket<WebSocketData>, error: Error): void {
  logger.error({ sessionId: ws.data.sessionId, error: error.message }, 'WebSocket error');
}

/**
 * Send a message to a specific WebSocket
 */
function sendMessage(ws: ServerWebSocket<WebSocketData>, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    logger.error({ sessionId: ws.data.sessionId, err }, 'Failed to send WebSocket message');
  }
}

/**
 * Broadcast a message to all subscribers of a job
 */
export function broadcastToJob(jobId: string, message: ServerMessage): void {
  const subscribers = jobSubscriptions.get(jobId);
  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const messageStr = JSON.stringify(message);
  let sentCount = 0;

  for (const sessionId of subscribers) {
    const ws = connections.get(sessionId);
    if (ws) {
      try {
        ws.send(messageStr);
        sentCount++;
      } catch (err) {
        logger.error({ sessionId, jobId, err }, 'Failed to broadcast message');
      }
    }
  }

  logger.debug({ jobId, subscriberCount: subscribers.size, sentCount }, 'Broadcast message to job subscribers');
}

/**
 * Start heartbeat monitoring
 */
export function startHeartbeat(): void {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    let closedCount = 0;

    for (const [sessionId, ws] of connections) {
      const timeSinceLastPing = now - ws.data.lastPing;

      if (timeSinceLastPing > HEARTBEAT_TIMEOUT) {
        logger.warn({ sessionId, timeSinceLastPing }, 'WebSocket connection timed out');
        ws.close(1000, 'Connection timed out');
        closedCount++;
      }
    }

    if (closedCount > 0) {
      logger.info({ closedCount }, 'Closed timed-out WebSocket connections');
    }
  }, HEARTBEAT_INTERVAL);

  logger.info({ interval: HEARTBEAT_INTERVAL, timeout: HEARTBEAT_TIMEOUT }, 'WebSocket heartbeat started');
}

/**
 * Stop heartbeat monitoring
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info('WebSocket heartbeat stopped');
  }
}

/**
 * Close all connections
 */
export function closeAllConnections(): void {
  for (const ws of connections.values()) {
    ws.close(1001, 'Server shutting down');
  }
  connections.clear();
  jobSubscriptions.clear();
  logger.info('All WebSocket connections closed');
}

/**
 * Get connection statistics
 */
export function getConnectionStats(): {
  totalConnections: number;
  activeSubscriptions: number;
  jobsWithSubscribers: number;
} {
  let activeSubscriptions = 0;
  for (const subscribers of jobSubscriptions.values()) {
    activeSubscriptions += subscribers.size;
  }

  return {
    totalConnections: connections.size,
    activeSubscriptions,
    jobsWithSubscribers: jobSubscriptions.size,
  };
}
