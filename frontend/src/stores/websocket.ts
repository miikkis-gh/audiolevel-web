import { writable, derived, get } from 'svelte/store';

// WebSocket message types
export const WS_MESSAGE_TYPES = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PING: 'ping',
  PROGRESS: 'progress',
  COMPLETE: 'complete',
  ERROR: 'error',
  PONG: 'pong',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
} as const;

// Message interfaces
export interface ProgressMessage {
  type: typeof WS_MESSAGE_TYPES.PROGRESS;
  jobId: string;
  percent: number;
  stage?: string;
}

// Processing report from intelligent processor
export interface ProcessingReportMessage {
  contentType: string;
  contentConfidence: number;
  problemsDetected: { problem: string; details: string; severity?: string }[];
  processingApplied: string[];
  candidatesTested: { name: string; score: number; isWinner: boolean }[];
  winnerReason: string;
}

export interface CompleteMessage {
  type: typeof WS_MESSAGE_TYPES.COMPLETE;
  jobId: string;
  downloadUrl: string;
  duration?: number;
  inputLufs?: number;
  outputLufs?: number;
  processingReport?: ProcessingReportMessage;
}

export interface ErrorMessage {
  type: typeof WS_MESSAGE_TYPES.ERROR;
  jobId: string;
  message: string;
  code?: string;
}

export interface PongMessage {
  type: typeof WS_MESSAGE_TYPES.PONG;
  timestamp?: number;
}

export interface SubscribedMessage {
  type: typeof WS_MESSAGE_TYPES.SUBSCRIBED;
  jobId: string;
}

export interface UnsubscribedMessage {
  type: typeof WS_MESSAGE_TYPES.UNSUBSCRIBED;
  jobId: string;
}

export type ServerMessage =
  | ProgressMessage
  | CompleteMessage
  | ErrorMessage
  | PongMessage
  | SubscribedMessage
  | UnsubscribedMessage;

// Connection state
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface WebSocketState {
  connectionState: ConnectionState;
  lastError: string | null;
  reconnectAttempts: number;
}

// Stores
export const connectionState = writable<ConnectionState>('disconnected');
export const lastError = writable<string | null>(null);
export const reconnectAttempts = writable<number>(0);

// Job progress store: jobId -> progress info
export const jobProgress = writable<Map<string, { percent: number; stage?: string }>>(new Map());

// Job results store: jobId -> completion/error info
export const jobResults = writable<Map<string, {
  success: boolean;
  downloadUrl?: string;
  error?: string;
  processingReport?: ProcessingReportMessage;
}>>(new Map());

// Derived store for checking if connected
export const isConnected = derived(connectionState, ($state) => $state === 'connected');

// WebSocket client class
class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 30000; // 30 seconds
  private pingInterval = 25000; // 25 seconds
  private subscribedJobs = new Set<string>();

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    connectionState.set('connecting');
    lastError.set(null);

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect';
      lastError.set(errorMessage);
      connectionState.set('disconnected');
      this.scheduleReconnect();
    }
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      connectionState.set('connected');
      reconnectAttempts.set(0);
      lastError.set(null);

      // Resubscribe to any jobs we were tracking
      for (const jobId of this.subscribedJobs) {
        this.sendSubscribe(jobId);
      }

      // Start ping interval
      this.startPingInterval();
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        this.handleMessage(message);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = (event) => {
      this.stopPingInterval();

      if (event.wasClean) {
        connectionState.set('disconnected');
      } else {
        lastError.set(`Connection lost (code: ${event.code})`);
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      lastError.set('WebSocket error occurred');
    };
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case WS_MESSAGE_TYPES.PROGRESS:
        jobProgress.update((map) => {
          map.set(message.jobId, {
            percent: message.percent,
            stage: message.stage,
          });
          return new Map(map);
        });
        break;

      case WS_MESSAGE_TYPES.COMPLETE:
        jobResults.update((map) => {
          map.set(message.jobId, {
            success: true,
            downloadUrl: message.downloadUrl,
            processingReport: message.processingReport,
          });
          return new Map(map);
        });
        // Set progress to 100%
        jobProgress.update((map) => {
          map.set(message.jobId, { percent: 100 });
          return new Map(map);
        });
        break;

      case WS_MESSAGE_TYPES.ERROR:
        jobResults.update((map) => {
          map.set(message.jobId, {
            success: false,
            error: message.message,
          });
          return new Map(map);
        });
        break;

      case WS_MESSAGE_TYPES.PONG:
        // Heartbeat received, connection is alive
        break;

      default:
        // Handle other message types (subscribed, unsubscribed)
        break;
    }
  }

  private scheduleReconnect(): void {
    const attempts = get(reconnectAttempts);

    if (attempts >= this.maxReconnectAttempts) {
      connectionState.set('disconnected');
      lastError.set('Max reconnection attempts reached');
      return;
    }

    connectionState.set('reconnecting');

    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, attempts) + Math.random() * 1000,
      this.maxReconnectDelay
    );

    this.reconnectTimer = setTimeout(() => {
      reconnectAttempts.update((n) => n + 1);
      this.connect();
    }, delay);
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingTimer = setInterval(() => {
      this.sendPing();
    }, this.pingInterval);
  }

  private stopPingInterval(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private sendPing(): void {
    this.send({ type: WS_MESSAGE_TYPES.PING });
  }

  private sendSubscribe(jobId: string): void {
    this.send({ type: WS_MESSAGE_TYPES.SUBSCRIBE, jobId });
  }

  private sendUnsubscribe(jobId: string): void {
    this.send({ type: WS_MESSAGE_TYPES.UNSUBSCRIBE, jobId });
  }

  subscribe(jobId: string): void {
    this.subscribedJobs.add(jobId);

    // Initialize progress for this job
    jobProgress.update((map) => {
      if (!map.has(jobId)) {
        map.set(jobId, { percent: 0 });
      }
      return new Map(map);
    });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(jobId);
    }
  }

  unsubscribe(jobId: string): void {
    this.subscribedJobs.delete(jobId);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendUnsubscribe(jobId);
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopPingInterval();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }

    this.subscribedJobs.clear();
    connectionState.set('disconnected');
  }

  clearJob(jobId: string): void {
    this.unsubscribe(jobId);
    jobProgress.update((map) => {
      map.delete(jobId);
      return new Map(map);
    });
    jobResults.update((map) => {
      map.delete(jobId);
      return new Map(map);
    });
  }
}

// Singleton instance
let wsClient: WebSocketClient | null = null;

export function getWebSocketClient(): WebSocketClient {
  if (!wsClient) {
    // Use environment variable if set, otherwise construct from current location
    let wsUrl = import.meta.env.VITE_WS_URL;
    if (!wsUrl) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${protocol}//${window.location.host}/ws`;
    }
    wsClient = new WebSocketClient(wsUrl);
  }
  return wsClient;
}

export function connectWebSocket(): void {
  getWebSocketClient().connect();
}

export function disconnectWebSocket(): void {
  if (wsClient) {
    wsClient.disconnect();
  }
}

export function subscribeToJob(jobId: string): void {
  getWebSocketClient().subscribe(jobId);
}

export function unsubscribeFromJob(jobId: string): void {
  getWebSocketClient().unsubscribe(jobId);
}

export function clearJobData(jobId: string): void {
  getWebSocketClient().clearJob(jobId);
}

// Helper to get progress for a specific job
export function getJobProgress(jobId: string) {
  return derived(jobProgress, ($progress) => $progress.get(jobId) ?? { percent: 0 });
}

// Helper to get result for a specific job
export function getJobResult(jobId: string) {
  return derived(jobResults, ($results) => $results.get(jobId));
}
