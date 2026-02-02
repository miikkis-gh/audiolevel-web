import { describe, expect, test } from 'bun:test';
import {
  WS_MESSAGE_TYPES,
  clientMessageSchema,
  createProgressMessage,
  createCompleteMessage,
  createErrorMessage,
  createPongMessage,
  createSubscribedMessage,
  createUnsubscribedMessage,
} from '../websocket/types';

describe('WebSocket Types', () => {
  describe('WS_MESSAGE_TYPES', () => {
    test('client message types are defined', () => {
      expect(WS_MESSAGE_TYPES.SUBSCRIBE).toBe('subscribe');
      expect(WS_MESSAGE_TYPES.UNSUBSCRIBE).toBe('unsubscribe');
      expect(WS_MESSAGE_TYPES.PING).toBe('ping');
    });

    test('server message types are defined', () => {
      expect(WS_MESSAGE_TYPES.PROGRESS).toBe('progress');
      expect(WS_MESSAGE_TYPES.COMPLETE).toBe('complete');
      expect(WS_MESSAGE_TYPES.ERROR).toBe('error');
      expect(WS_MESSAGE_TYPES.PONG).toBe('pong');
      expect(WS_MESSAGE_TYPES.SUBSCRIBED).toBe('subscribed');
      expect(WS_MESSAGE_TYPES.UNSUBSCRIBED).toBe('unsubscribed');
    });
  });

  describe('clientMessageSchema', () => {
    test('validates subscribe message', () => {
      const result = clientMessageSchema.safeParse({
        type: 'subscribe',
        jobId: 'job-123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('subscribe');
        if (result.data.type === 'subscribe') {
          expect(result.data.jobId).toBe('job-123');
        }
      }
    });

    test('validates unsubscribe message', () => {
      const result = clientMessageSchema.safeParse({
        type: 'unsubscribe',
        jobId: 'job-456',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('unsubscribe');
        if (result.data.type === 'unsubscribe') {
          expect(result.data.jobId).toBe('job-456');
        }
      }
    });

    test('validates ping message', () => {
      const result = clientMessageSchema.safeParse({
        type: 'ping',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('ping');
      }
    });

    test('rejects invalid message type', () => {
      const result = clientMessageSchema.safeParse({
        type: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    test('rejects subscribe with empty jobId', () => {
      const result = clientMessageSchema.safeParse({
        type: 'subscribe',
        jobId: '',
      });
      expect(result.success).toBe(false);
    });

    test('rejects subscribe without jobId', () => {
      const result = clientMessageSchema.safeParse({
        type: 'subscribe',
      });
      expect(result.success).toBe(false);
    });

    test('rejects malformed message', () => {
      const result = clientMessageSchema.safeParse('not an object');
      expect(result.success).toBe(false);
    });

    test('rejects null message', () => {
      const result = clientMessageSchema.safeParse(null);
      expect(result.success).toBe(false);
    });
  });

  describe('Server Message Creators', () => {
    describe('createProgressMessage', () => {
      test('creates progress message with required fields', () => {
        const msg = createProgressMessage('job-123', 50);
        expect(msg.type).toBe('progress');
        expect(msg.jobId).toBe('job-123');
        expect(msg.percent).toBe(50);
        expect(msg.stage).toBeUndefined();
      });

      test('creates progress message with optional stage', () => {
        const msg = createProgressMessage('job-123', 75, 'Normalizing');
        expect(msg.type).toBe('progress');
        expect(msg.jobId).toBe('job-123');
        expect(msg.percent).toBe(75);
        expect(msg.stage).toBe('Normalizing');
      });

      test('handles 0% progress', () => {
        const msg = createProgressMessage('job-123', 0);
        expect(msg.percent).toBe(0);
      });

      test('handles 100% progress', () => {
        const msg = createProgressMessage('job-123', 100);
        expect(msg.percent).toBe(100);
      });
    });

    describe('createCompleteMessage', () => {
      test('creates complete message with required fields', () => {
        const msg = createCompleteMessage('job-123', '/api/download/job-123');
        expect(msg.type).toBe('complete');
        expect(msg.jobId).toBe('job-123');
        expect(msg.downloadUrl).toBe('/api/download/job-123');
      });

      test('creates complete message with optional duration', () => {
        const msg = createCompleteMessage('job-123', '/api/download/job-123', {
          duration: 5.5,
        });
        expect(msg.duration).toBe(5.5);
      });

      test('creates complete message with loudness data', () => {
        const msg = createCompleteMessage('job-123', '/api/download/job-123', {
          duration: 3.2,
          inputLufs: -18.5,
          outputLufs: -14.0,
        });
        expect(msg.duration).toBe(3.2);
        expect(msg.inputLufs).toBe(-18.5);
        expect(msg.outputLufs).toBe(-14.0);
      });
    });

    describe('createErrorMessage', () => {
      test('creates error message with required fields', () => {
        const msg = createErrorMessage('job-123', 'Processing failed');
        expect(msg.type).toBe('error');
        expect(msg.jobId).toBe('job-123');
        expect(msg.message).toBe('Processing failed');
        expect(msg.code).toBeUndefined();
      });

      test('creates error message with optional code', () => {
        const msg = createErrorMessage(
          'job-123',
          'File too large',
          'FILE_TOO_LARGE'
        );
        expect(msg.type).toBe('error');
        expect(msg.jobId).toBe('job-123');
        expect(msg.message).toBe('File too large');
        expect(msg.code).toBe('FILE_TOO_LARGE');
      });
    });

    describe('createPongMessage', () => {
      test('creates pong message with timestamp', () => {
        const before = Date.now();
        const msg = createPongMessage();
        const after = Date.now();

        expect(msg.type).toBe('pong');
        expect(msg.timestamp).toBeGreaterThanOrEqual(before);
        expect(msg.timestamp).toBeLessThanOrEqual(after);
      });
    });

    describe('createSubscribedMessage', () => {
      test('creates subscribed message', () => {
        const msg = createSubscribedMessage('job-123');
        expect(msg.type).toBe('subscribed');
        expect(msg.jobId).toBe('job-123');
      });
    });

    describe('createUnsubscribedMessage', () => {
      test('creates unsubscribed message', () => {
        const msg = createUnsubscribedMessage('job-123');
        expect(msg.type).toBe('unsubscribed');
        expect(msg.jobId).toBe('job-123');
      });
    });
  });
});
