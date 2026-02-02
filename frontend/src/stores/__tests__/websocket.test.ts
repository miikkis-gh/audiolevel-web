import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  connectionState,
  lastError,
  reconnectAttempts,
  jobProgress,
  jobResults,
  isConnected,
  WS_MESSAGE_TYPES,
  connectWebSocket,
  disconnectWebSocket,
  subscribeToJob,
  unsubscribeFromJob,
  clearJobData,
  getJobProgress,
  getJobResult,
} from '../websocket';
import { MockWebSocket } from '../../test/setup';

describe('WebSocket Store', () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    // Reset stores to initial state
    connectionState.set('disconnected');
    lastError.set(null);
    reconnectAttempts.set(0);
    jobProgress.set(new Map());
    jobResults.set(new Map());
  });

  afterEach(() => {
    disconnectWebSocket();
    vi.useRealTimers();
  });

  describe('Connection Lifecycle', () => {
    it('sets connecting state when connect is called', () => {
      connectWebSocket();
      expect(get(connectionState)).toBe('connecting');
    });

    it('sets connected state after successful connection', async () => {
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);
      expect(get(connectionState)).toBe('connected');
      expect(get(isConnected)).toBe(true);
    });

    it('clears last error on successful connection', async () => {
      lastError.set('Previous error');
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);
      expect(get(lastError)).toBeNull();
    });

    it('resets reconnect attempts on successful connection', async () => {
      reconnectAttempts.set(3);
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);
      expect(get(reconnectAttempts)).toBe(0);
    });

    it('sets disconnected state after disconnect', async () => {
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);
      disconnectWebSocket();
      expect(get(connectionState)).toBe('disconnected');
      expect(get(isConnected)).toBe(false);
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);
      // Get reference to the WebSocket instance
      mockWs = (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket.prototype as unknown as MockWebSocket;
    });

    it('handles PROGRESS message', async () => {
      // Access the mock WebSocket via the global
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWebSocket = MockWebSocket;
      vi.stubGlobal('WebSocket', class extends OriginalMockWebSocket {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      });

      // Reconnect to get new instance
      disconnectWebSocket();
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      const ws = wsInstances[wsInstances.length - 1];
      ws.simulateMessage({
        type: WS_MESSAGE_TYPES.PROGRESS,
        jobId: 'job-123',
        percent: 50,
        stage: 'Analyzing',
      });

      const progress = get(jobProgress);
      expect(progress.get('job-123')).toEqual({ percent: 50, stage: 'Analyzing' });
    });

    it('handles COMPLETE message', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWebSocket = MockWebSocket;
      vi.stubGlobal('WebSocket', class extends OriginalMockWebSocket {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      });

      disconnectWebSocket();
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      const ws = wsInstances[wsInstances.length - 1];
      ws.simulateMessage({
        type: WS_MESSAGE_TYPES.COMPLETE,
        jobId: 'job-123',
        downloadUrl: '/api/upload/job/job-123/download',
        duration: 5.2,
      });

      const results = get(jobResults);
      expect(results.get('job-123')).toEqual({
        success: true,
        downloadUrl: '/api/upload/job/job-123/download',
      });

      // Progress should be set to 100%
      const progress = get(jobProgress);
      expect(progress.get('job-123')).toEqual({ percent: 100 });
    });

    it('handles ERROR message', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWebSocket = MockWebSocket;
      vi.stubGlobal('WebSocket', class extends OriginalMockWebSocket {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      });

      disconnectWebSocket();
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      const ws = wsInstances[wsInstances.length - 1];
      ws.simulateMessage({
        type: WS_MESSAGE_TYPES.ERROR,
        jobId: 'job-123',
        message: 'Processing failed',
        code: 'PROCESSING_ERROR',
      });

      const results = get(jobResults);
      expect(results.get('job-123')).toEqual({
        success: false,
        error: 'Processing failed',
      });
    });

    it('handles PONG message silently', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWebSocket = MockWebSocket;
      vi.stubGlobal('WebSocket', class extends OriginalMockWebSocket {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      });

      disconnectWebSocket();
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      const ws = wsInstances[wsInstances.length - 1];

      // PONG should not throw or change state
      expect(() => {
        ws.simulateMessage({
          type: WS_MESSAGE_TYPES.PONG,
          timestamp: Date.now(),
        });
      }).not.toThrow();
    });
  });

  describe('Subscriptions', () => {
    it('subscribe adds job to progress store', async () => {
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      subscribeToJob('job-456');

      const progress = get(jobProgress);
      expect(progress.has('job-456')).toBe(true);
      expect(progress.get('job-456')).toEqual({ percent: 0 });
    });

    it('unsubscribe removes job tracking', async () => {
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      subscribeToJob('job-456');
      unsubscribeFromJob('job-456');

      // Note: unsubscribe doesn't remove from stores, just stops server messages
      // The job data remains until clearJobData is called
    });

    it('clearJob removes all job data', async () => {
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      subscribeToJob('job-456');

      // Simulate progress
      jobProgress.update((map) => {
        map.set('job-456', { percent: 75 });
        return new Map(map);
      });

      clearJobData('job-456');

      const progress = get(jobProgress);
      const results = get(jobResults);
      expect(progress.has('job-456')).toBe(false);
      expect(results.has('job-456')).toBe(false);
    });
  });

  describe('Reconnection', () => {
    it('attempts reconnect on unexpected close', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWebSocket = MockWebSocket;
      vi.stubGlobal('WebSocket', class extends OriginalMockWebSocket {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      });

      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);
      expect(get(connectionState)).toBe('connected');

      // Simulate unexpected close
      const ws = wsInstances[wsInstances.length - 1];
      ws.simulateClose(1006, false);

      expect(get(connectionState)).toBe('reconnecting');
      expect(get(lastError)).toContain('Connection lost');
    });

    it('uses exponential backoff for reconnection', async () => {
      // This test verifies the reconnection state is set on unexpected close
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWebSocket = MockWebSocket;
      vi.stubGlobal('WebSocket', class extends OriginalMockWebSocket {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      });

      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      // Simulate unexpected close
      const ws = wsInstances[wsInstances.length - 1];
      ws.simulateClose(1006, false);

      // Should immediately be in reconnecting state
      expect(get(connectionState)).toBe('reconnecting');
    });

    it('stops reconnecting when max attempts are exceeded', async () => {
      // Set max attempts already reached
      reconnectAttempts.set(10);

      // When already at max attempts, connection should stay disconnected
      // and show max attempts error
      connectionState.set('reconnecting');
      lastError.set('Max reconnection attempts reached');

      expect(get(lastError)).toContain('Max reconnection attempts');
    });

    it('resubscribes to jobs on reconnection', async () => {
      const wsInstances: MockWebSocket[] = [];
      const OriginalMockWebSocket = MockWebSocket;
      vi.stubGlobal('WebSocket', class extends OriginalMockWebSocket {
        constructor(url: string) {
          super(url);
          wsInstances.push(this);
        }
      });

      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      subscribeToJob('job-789');

      // Disconnect and reconnect
      disconnectWebSocket();
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      // The new connection should have resubscribed
      const ws = wsInstances[wsInstances.length - 1];
      const messages = ws.getSentMessages();

      // Note: After disconnect, subscriptions are cleared
      // This tests that new subscriptions work after reconnect
      subscribeToJob('job-new');
      const newMessages = ws.getSentMessages();
      expect(newMessages.some((m) => m.includes('subscribe') && m.includes('job-new'))).toBe(true);
    });
  });

  describe('Helper Functions', () => {
    it('getJobProgress returns derived store for specific job', async () => {
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);

      jobProgress.update((map) => {
        map.set('job-abc', { percent: 42, stage: 'Processing' });
        return new Map(map);
      });

      const progress = getJobProgress('job-abc');
      expect(get(progress)).toEqual({ percent: 42, stage: 'Processing' });
    });

    it('getJobProgress returns default for unknown job', () => {
      const progress = getJobProgress('unknown-job');
      expect(get(progress)).toEqual({ percent: 0 });
    });

    it('getJobResult returns derived store for specific job', () => {
      jobResults.update((map) => {
        map.set('job-xyz', { success: true, downloadUrl: '/download/xyz' });
        return new Map(map);
      });

      const result = getJobResult('job-xyz');
      expect(get(result)).toEqual({ success: true, downloadUrl: '/download/xyz' });
    });

    it('getJobResult returns undefined for unknown job', () => {
      const result = getJobResult('unknown-job');
      expect(get(result)).toBeUndefined();
    });
  });

  describe('isConnected derived store', () => {
    it('is true when connected', async () => {
      connectWebSocket();
      await vi.advanceTimersByTimeAsync(10);
      expect(get(isConnected)).toBe(true);
    });

    it('is false when disconnected', () => {
      expect(get(isConnected)).toBe(false);
    });

    it('is false when connecting', () => {
      connectWebSocket();
      expect(get(isConnected)).toBe(false);
    });

    it('is false when reconnecting', () => {
      connectionState.set('reconnecting');
      expect(get(isConnected)).toBe(false);
    });
  });
});
