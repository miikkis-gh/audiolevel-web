import { z } from 'zod';

// WebSocket message types
export const WS_MESSAGE_TYPES = {
  // Client -> Server
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PING: 'ping',

  // Server -> Client
  PROGRESS: 'progress',
  COMPLETE: 'complete',
  ERROR: 'error',
  PONG: 'pong',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
} as const;

// Client -> Server message schemas
export const subscribeMessageSchema = z.object({
  type: z.literal(WS_MESSAGE_TYPES.SUBSCRIBE),
  jobId: z.string().uuid(),
});

export const unsubscribeMessageSchema = z.object({
  type: z.literal(WS_MESSAGE_TYPES.UNSUBSCRIBE),
  jobId: z.string().uuid(),
});

export const pingMessageSchema = z.object({
  type: z.literal(WS_MESSAGE_TYPES.PING),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  subscribeMessageSchema,
  unsubscribeMessageSchema,
  pingMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// Server -> Client message types
export interface ProgressMessage {
  type: typeof WS_MESSAGE_TYPES.PROGRESS;
  jobId: string;
  percent: number;
  stage?: string;
}

export interface CompleteMessage {
  type: typeof WS_MESSAGE_TYPES.COMPLETE;
  jobId: string;
  downloadUrl: string;
  duration?: number;
  inputLufs?: number;
  outputLufs?: number;
}

export interface ErrorMessage {
  type: typeof WS_MESSAGE_TYPES.ERROR;
  jobId: string;
  message: string;
  code?: string;
}

export interface PongMessage {
  type: typeof WS_MESSAGE_TYPES.PONG;
  timestamp: number;
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

// Helper functions to create server messages
export function createProgressMessage(
  jobId: string,
  percent: number,
  stage?: string
): ProgressMessage {
  return {
    type: WS_MESSAGE_TYPES.PROGRESS,
    jobId,
    percent,
    stage,
  };
}

export function createCompleteMessage(
  jobId: string,
  downloadUrl: string,
  options?: { duration?: number; inputLufs?: number; outputLufs?: number }
): CompleteMessage {
  return {
    type: WS_MESSAGE_TYPES.COMPLETE,
    jobId,
    downloadUrl,
    ...options,
  };
}

export function createErrorMessage(
  jobId: string,
  message: string,
  code?: string
): ErrorMessage {
  return {
    type: WS_MESSAGE_TYPES.ERROR,
    jobId,
    message,
    code,
  };
}

export function createPongMessage(): PongMessage {
  return {
    type: WS_MESSAGE_TYPES.PONG,
    timestamp: Date.now(),
  };
}

export function createSubscribedMessage(jobId: string): SubscribedMessage {
  return {
    type: WS_MESSAGE_TYPES.SUBSCRIBED,
    jobId,
  };
}

export function createUnsubscribedMessage(jobId: string): UnsubscribedMessage {
  return {
    type: WS_MESSAGE_TYPES.UNSUBSCRIBED,
    jobId,
  };
}
