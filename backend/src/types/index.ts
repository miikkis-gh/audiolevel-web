/**
 * Shared type definitions for AudioLevel backend
 *
 * Re-exports commonly used types from various modules for convenient imports.
 * Import from '@/types' instead of individual service files.
 */

// Queue types
export type {
  AudioJobData,
  AudioJobResult,
  DetectedProfileInfo,
  QueueStatus,
} from '../services/queue';

export { JobPriority } from '../services/queue';

// Processing types
export type {
  ProcessingOptions,
  ProcessingResult,
  ProcessingCallbacks,
} from '../services/audioProcessor';

export type {
  NormalizationResult,
  NormalizationAnalysis,
  NormalizationCallbacks,
} from '../services/normalizationProcessor';

export type {
  MasteringResult,
  MasteringAnalysis,
  MasteringCallbacks,
  PreflightResult,
} from '../services/masteringProcessor';

// Profile detection types
export type {
  AudioProfile,
  ProfileDetectionResult,
} from '../services/profileDetector';

// FFmpeg utility types
export type {
  CommandResult,
  RunCommandOptions,
  AudioMetadata,
  LoudnessAnalysis,
  FFmpegCommand,
} from '../utils/ffmpeg';

// WebSocket types
export type {
  ClientMessage,
  ServerMessage,
  ProgressMessage,
  CompleteMessage,
  ErrorMessage,
} from '../websocket/types';

// Rate limiting types
export type {
  RateLimitResult,
  RateLimitConfig,
} from '../services/rateLimit';

// Disk monitoring types
export type {
  DiskUsage,
  DiskThresholds,
} from '../services/diskMonitor';
