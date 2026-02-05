import { z } from 'zod';
import { JOB_ID } from '../config/constants';

// WebSocket message types
export const WS_MESSAGE_TYPES = {
  // Client -> Server
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  SUBSCRIBE_ACTIVITY: 'subscribe_activity',
  UNSUBSCRIBE_ACTIVITY: 'unsubscribe_activity',
  PING: 'ping',

  // Server -> Client
  PROGRESS: 'progress',
  COMPLETE: 'complete',
  ERROR: 'error',
  PONG: 'pong',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
  ACTIVITY: 'activity',
  ACTIVITY_SUBSCRIBED: 'activity_subscribed',
  ACTIVITY_UNSUBSCRIBED: 'activity_unsubscribed',
} as const;

// Client -> Server message schemas
export const subscribeMessageSchema = z.object({
  type: z.literal(WS_MESSAGE_TYPES.SUBSCRIBE),
  jobId: z.string().regex(JOB_ID.REGEX, 'Invalid job ID format'),
});

export const unsubscribeMessageSchema = z.object({
  type: z.literal(WS_MESSAGE_TYPES.UNSUBSCRIBE),
  jobId: z.string().regex(JOB_ID.REGEX, 'Invalid job ID format'),
});

export const pingMessageSchema = z.object({
  type: z.literal(WS_MESSAGE_TYPES.PING),
});

export const subscribeActivityMessageSchema = z.object({
  type: z.literal(WS_MESSAGE_TYPES.SUBSCRIBE_ACTIVITY),
});

export const unsubscribeActivityMessageSchema = z.object({
  type: z.literal(WS_MESSAGE_TYPES.UNSUBSCRIBE_ACTIVITY),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  subscribeMessageSchema,
  unsubscribeMessageSchema,
  subscribeActivityMessageSchema,
  unsubscribeActivityMessageSchema,
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

// Processing report for intelligent processing
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

export interface ActivityMessage {
  type: typeof WS_MESSAGE_TYPES.ACTIVITY;
  contentType: string;
  timestamp: number;
}

export interface ActivitySubscribedMessage {
  type: typeof WS_MESSAGE_TYPES.ACTIVITY_SUBSCRIBED;
}

export interface ActivityUnsubscribedMessage {
  type: typeof WS_MESSAGE_TYPES.ACTIVITY_UNSUBSCRIBED;
}

export type ServerMessage =
  | ProgressMessage
  | CompleteMessage
  | ErrorMessage
  | PongMessage
  | SubscribedMessage
  | UnsubscribedMessage
  | ActivityMessage
  | ActivitySubscribedMessage
  | ActivityUnsubscribedMessage;

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
  options?: {
    duration?: number;
    inputLufs?: number;
    outputLufs?: number;
    processingReport?: ProcessingReportMessage;
  }
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

export function createActivityMessage(contentType: string): ActivityMessage {
  return {
    type: WS_MESSAGE_TYPES.ACTIVITY,
    contentType,
    timestamp: Date.now(),
  };
}

export function createActivitySubscribedMessage(): ActivitySubscribedMessage {
  return {
    type: WS_MESSAGE_TYPES.ACTIVITY_SUBSCRIBED,
  };
}

export function createActivityUnsubscribedMessage(): ActivityUnsubscribedMessage {
  return {
    type: WS_MESSAGE_TYPES.ACTIVITY_UNSUBSCRIBED,
  };
}
