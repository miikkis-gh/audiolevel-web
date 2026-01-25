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

export interface JobStatus {
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress: number;
  result?: {
    success: boolean;
    outputPath?: string;
    error?: string;
  };
  error?: string;
}

export async function fetchPresets(): Promise<Preset[]> {
  const response = await fetch(`${API_URL}/api/presets`);
  if (!response.ok) {
    throw new Error('Failed to fetch presets');
  }
  const data = await response.json();
  return data.presets;
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
    const error = await response.json();
    throw new Error(error.error || 'Upload failed');
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
