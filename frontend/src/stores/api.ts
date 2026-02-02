const API_URL = import.meta.env.VITE_API_URL || '';

export interface Preset {
  id: string;
  name: string;
  description: string;
  targetLufs: number;
  truePeak: number;
  loudnessRange?: number;
}

export interface UploadResponse {
  jobId: string;
  status: string;
  preset: string;
  originalName: string;
}

export interface LoudnessAnalysis {
  inputLufs: number;
  inputTruePeak: number;
  inputLoudnessRange?: number;
}

export interface JobResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  duration?: number;
  processingType?: 'ffmpeg-normalize' | 'direct-copy' | 'mastering-pipeline';
  masteringDecisions?: {
    compressionEnabled: boolean;
    saturationEnabled: boolean;
  };
  filterChain?: string;
  inputAnalysis?: LoudnessAnalysis;
  outputAnalysis?: LoudnessAnalysis;
}

export interface JobStatus {
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress: number;
  result?: JobResult;
  error?: string;
}

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  used: number;
  resetAt: number;
  windowMs: number;
}

export interface ApiError extends Error {
  code?: string;
  status?: number;
  retryAfter?: number;
  hint?: string;
}

export interface QueueStatus {
  status: 'normal' | 'warning' | 'overloaded';
  acceptingJobs: boolean;
  estimatedWaitTime?: number;
  waiting: number;
  active: number;
}

// Helper to create enhanced API errors
function createApiError(response: Response, data: { error?: string; code?: string; hint?: string }): ApiError {
  const error = new Error(data.error || getDefaultErrorMessage(response.status)) as ApiError;
  error.code = data.code;
  error.status = response.status;
  error.hint = data.hint;

  // Handle rate limit
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    error.retryAfter = retryAfter ? parseInt(retryAfter, 10) : undefined;
  }

  return error;
}

// Default error messages for common status codes
function getDefaultErrorMessage(status: number): string {
  switch (status) {
    case 400: return 'Invalid request';
    case 401: return 'Authentication required';
    case 403: return 'Access denied';
    case 404: return 'Not found';
    case 429: return 'Too many requests';
    case 500: return 'Server error';
    case 503: return 'Service unavailable';
    default: return 'An error occurred';
  }
}

export async function fetchPresets(): Promise<Preset[]> {
  const response = await fetch(`${API_URL}/api/presets`);
  if (!response.ok) {
    throw new Error('Failed to fetch presets');
  }
  const data = await response.json();
  return data.presets;
}

export async function fetchRateLimitStatus(): Promise<RateLimitStatus> {
  const response = await fetch(`${API_URL}/api/upload/rate-limit`);
  if (!response.ok) {
    throw new Error('Failed to fetch rate limit status');
  }
  return response.json();
}

export async function fetchQueueStatus(): Promise<QueueStatus> {
  const response = await fetch(`${API_URL}/api/upload/queue-status`);
  if (!response.ok) {
    throw new Error('Failed to fetch queue status');
  }
  return response.json();
}

export async function uploadFile(file: File, preset: string): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('preset', preset);

  const response = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw createApiError(response, errorData);
  }

  return response.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const response = await fetch(`${API_URL}/api/upload/job/${jobId}`);
  if (!response.ok) {
    throw new Error('Failed to get job status');
  }
  return response.json();
}

export function getDownloadUrl(jobId: string): string {
  return `${API_URL}/api/upload/job/${jobId}/download`;
}
