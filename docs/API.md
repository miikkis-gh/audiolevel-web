# AudioLevel API Documentation

## Base URL

Development: `http://localhost:3000/api`
Production: `https://your-domain.com/api`

## Endpoints

### Health & Monitoring

#### GET /health
Returns the overall health status of the service.

**Response**
```json
{
  "status": "healthy" | "degraded",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "redis": "up" | "down",
    "worker": "up" | "down"
  },
  "worker": {
    "running": true,
    "concurrency": 4
  }
}
```

#### GET /health/ready
Check if the service is ready to accept requests.

**Response**
```json
{
  "ready": true,
  "reason": null
}
```

#### GET /health/dependencies
Check FFmpeg and related tool availability.

**Response**
```json
{
  "status": "ok" | "missing",
  "dependencies": {
    "ffmpeg": "available" | "missing",
    "ffprobe": "available" | "missing",
    "ffmpeg-normalize": "available" | "missing"
  }
}
```

#### GET /health/queue
Get current queue statistics.

**Response**
```json
{
  "healthy": true,
  "status": "normal" | "warning" | "overloaded",
  "acceptingJobs": true,
  "issues": [],
  "counts": {
    "waiting": 0,
    "active": 0,
    "completed": 100,
    "failed": 2,
    "delayed": 0
  },
  "estimatedWaitTime": 0
}
```

#### GET /health/disk
Get disk usage information.

**Response**
```json
{
  "status": "ok" | "warning" | "critical",
  "message": "Disk usage normal",
  "disk": {
    "total": "100 GB",
    "free": "80 GB",
    "used": "20 GB",
    "usedPercent": "20.0%"
  }
}
```

#### GET /health/storage
Get file storage statistics.

**Response**
```json
{
  "uploads": {
    "files": 5,
    "size": "150 MB",
    "sizeBytes": 157286400
  },
  "outputs": {
    "files": 5,
    "size": "120 MB",
    "sizeBytes": 125829120
  },
  "total": {
    "files": 10,
    "size": "270 MB",
    "sizeBytes": 283115520
  }
}
```

#### GET /health/summary
Get comprehensive health summary with alerts.

**Response**
```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "alerts": [],
  "services": {
    "redis": true,
    "worker": true,
    "queue": true,
    "disk": true,
    "dependencies": true
  },
  "queue": {
    "status": "normal",
    "waiting": 0,
    "active": 0,
    "acceptingJobs": true
  },
  "disk": {
    "status": "ok",
    "usedPercent": 20.5,
    "freeBytes": 85899345920
  }
}
```

---

### Presets

#### GET /presets
Get available normalization presets.

**Response**
```json
{
  "presets": [
    {
      "id": "podcast",
      "name": "Podcast",
      "description": "Optimized for spoken word podcasts (-16 LUFS)",
      "targetLufs": -16,
      "truePeak": -1.5,
      "loudnessRange": 7
    },
    {
      "id": "broadcast",
      "name": "Broadcast",
      "description": "TV/Radio broadcast compliance (-23 LUFS)",
      "targetLufs": -23,
      "truePeak": -2
    },
    ...
  ]
}
```

---

### Upload & Processing

#### GET /upload/rate-limit
Check your current rate limit status.

**Response**
```json
{
  "limit": 10,
  "remaining": 8,
  "used": 2,
  "resetAt": 1704067200000,
  "windowMs": 3600000
}
```

#### GET /upload/queue-status
Get current queue status for graceful degradation.

**Response**
```json
{
  "status": "normal" | "warning" | "overloaded",
  "acceptingJobs": true,
  "estimatedWaitTime": 60,
  "waiting": 5,
  "active": 2
}
```

#### POST /upload
Upload an audio file for normalization.

**Request**
- Content-Type: `multipart/form-data`
- Body:
  - `file` (required): Audio file (max 100MB)
  - `preset` (optional): Preset ID (default: "podcast")
  - `outputFormat` (optional): Output format (wav, mp3, flac, aac, ogg) (default: "wav")

**Supported Audio Formats**
- WAV (audio/wav, audio/x-wav)
- MP3 (audio/mp3, audio/mpeg)
- FLAC (audio/flac, audio/x-flac)
- AAC (audio/aac)
- OGG (audio/ogg, audio/vorbis)

**Response (201 Created)**
```json
{
  "jobId": "abc123xyz",
  "status": "queued",
  "preset": "podcast",
  "outputFormat": "wav",
  "originalName": "my-audio.mp3",
  "estimatedWaitTime": 60
}
```

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 400 | NO_FILE | No file was uploaded |
| 400 | FILE_TOO_LARGE | File exceeds 100MB limit |
| 400 | INVALID_FILE_TYPE | Unsupported file format |
| 400 | INVALID_FORMAT | File is corrupted or invalid |
| 429 | RATE_LIMITED | Upload limit reached (10/hour) |
| 503 | QUEUE_OVERLOADED | Server is busy |
| 503 | INSUFFICIENT_STORAGE | Server storage is full |

#### GET /upload/job/:id
Get job status and progress.

**Response**
```json
{
  "jobId": "abc123xyz",
  "status": "waiting" | "active" | "completed" | "failed" | "delayed",
  "progress": 75,
  "result": {
    "success": true,
    "outputPath": "/outputs/abc123xyz-output.wav"
  },
  "error": null
}
```

#### GET /upload/job/:id/download
Download the processed audio file.

**Response**
- Content-Type: `application/octet-stream` or specific audio MIME type
- Content-Disposition: `attachment; filename="original-name-normalized.wav"`

**Error Responses**

| Status | Code | Description |
|--------|------|-------------|
| 404 | JOB_NOT_FOUND | Job does not exist |
| 400 | NOT_READY | File is still being processed |
| 404 | FILE_EXPIRED | File has been deleted (15 min TTL) |

---

### WebSocket

#### WS /ws
Real-time progress updates via WebSocket.

**Connection**
```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
```

**Client Messages**

Subscribe to job updates:
```json
{ "type": "subscribe", "jobId": "abc123xyz" }
```

Unsubscribe from job updates:
```json
{ "type": "unsubscribe", "jobId": "abc123xyz" }
```

Ping (keepalive):
```json
{ "type": "ping" }
```

**Server Messages**

Progress update:
```json
{
  "type": "progress",
  "jobId": "abc123xyz",
  "percent": 75,
  "stage": "Normalizing audio..."
}
```

Completion:
```json
{
  "type": "complete",
  "jobId": "abc123xyz",
  "downloadUrl": "/api/upload/job/abc123xyz/download"
}
```

Error:
```json
{
  "type": "error",
  "jobId": "abc123xyz",
  "message": "Processing failed: Invalid audio format"
}
```

Pong (keepalive response):
```json
{ "type": "pong" }
```

---

## Error Response Format

All API errors follow this format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "hint": "Helpful suggestion for recovery"
}
```

## Rate Limiting

- **Limit**: 10 uploads per IP address per hour
- **Headers**: `Retry-After` header included in 429 responses
- **Tracking**: Uses Redis sliding window algorithm

## File Retention

All uploaded and processed files are automatically deleted after **15 minutes**. There is no way to recover files after deletion.

## Presets Reference

| Preset | Target LUFS | True Peak | Use Case |
|--------|-------------|-----------|----------|
| podcast | -16 | -1.5 dB | Spoken word podcasts |
| broadcast | -23 | -2 dB | TV/Radio compliance |
| youtube | -14 | -1 dB | YouTube uploads |
| streaming | -14 | -1 dB | Spotify, Apple Music |
| mastering | -9 | -0.3 dB | Loud masters |
| audiobook | -18 | -3 dB | ACX compliance |
