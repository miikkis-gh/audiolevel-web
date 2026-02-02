# AudioLevel Audio Processing System

A comprehensive technical reference for the audio processing pipeline.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [File Upload & Validation](#file-upload--validation)
3. [Job Queue System](#job-queue-system)
4. [Audio Processing Pipeline](#audio-processing-pipeline)
5. [Preset Configurations](#preset-configurations)
6. [Mastering Pipeline](#mastering-pipeline)
7. [WebSocket Progress Reporting](#websocket-progress-reporting)
8. [File Cleanup & Retention](#file-cleanup--retention)
9. [Environment Configuration](#environment-configuration)

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   Frontend  │────▶│   Backend   │
│             │◀────│   (Svelte)  │◀────│   (Hono)    │
└─────────────┘     └─────────────┘     └──────┬──────┘
       ▲                   │                   │
       │                   │ WebSocket         │ Jobs
       │                   ▼                   ▼
       │            ┌─────────────┐     ┌─────────────┐
       │            │  Progress   │     │   BullMQ    │
       └────────────│  Updates    │◀────│   + Redis   │
                    └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │   FFmpeg    │
                                        │  Normalize  │
                                        └─────────────┘
```

### Key Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Backend Server | Bun + Hono | REST API, file handling, WebSocket |
| Job Queue | BullMQ + Redis | Job scheduling, priority, retries |
| Audio Processing | FFmpeg + ffmpeg-normalize | Loudness normalization |
| Real-time Updates | WebSocket | Progress reporting to clients |

---

## File Upload & Validation

**Endpoint:** `POST /api/upload/`

### Validation Pipeline

```
Upload Request
     │
     ▼
┌─────────────────┐
│ Rate Limit Check │──▶ 10 uploads/hour/IP
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Extension Check │──▶ .wav, .mp3, .flac, .aac, .ogg, .m4a
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Magic Bytes     │──▶ Validates actual file content
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ File Size Check │──▶ Max 100MB (configurable)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Disk Space Check│──▶ Min 500MB + 3x file overhead
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Queue Capacity  │──▶ Graceful degradation under load
└────────┬────────┘
         │
         ▼
    Job Created
```

### Allowed Formats

| Extension | MIME Types |
|-----------|------------|
| `.wav` | `audio/wav`, `audio/x-wav` |
| `.mp3` | `audio/mp3`, `audio/mpeg` |
| `.flac` | `audio/flac`, `audio/x-flac` |
| `.aac` | `audio/aac` |
| `.ogg` | `audio/ogg`, `audio/vorbis` |
| `.m4a` | `audio/mp4`, `audio/x-m4a` |

### File Naming Convention

```
Input:  {jobId}-input.{extension}
Output: {jobId}-output.{extension}   (same format as input)
```

### Output Format Policy

**The output format always matches the input format.** No format conversion options in the UI. Upload a `.wav`, get a normalized `.wav` back. Upload an `.mp3`, get a normalized `.mp3` back.

---

## Job Queue System

**Location:** `backend/src/services/queue.ts`

### Queue Configuration

```typescript
Queue Name:        'audio-processing'
Connection:        Redis (REDIS_URL)
Default Retries:   3 attempts
Backoff Strategy:  Exponential (starting 1000ms)
Concurrent Jobs:   MAX_CONCURRENT_JOBS (default: 4)
```

### Priority System

Jobs are prioritized by file size (smaller = higher priority):

| Priority | Level | File Size |
|----------|-------|-----------|
| 1 | HIGH | < 5 MB |
| 5 | NORMAL | 5-25 MB |
| 10 | LOW | 25-50 MB |
| 15 | LOWEST | > 50 MB |

### Queue Status & Graceful Degradation

| Status | Waiting Jobs | Behavior |
|--------|--------------|----------|
| NORMAL | 0-9 | Accept all uploads |
| WARNING | 10-24 | Only accept files < 5MB |
| OVERLOADED | 50+ | Reject all new uploads |

### Estimated Wait Time

```
wait_time = (waiting_jobs / max_concurrent_jobs) × 60 seconds
```

---

## Audio Processing Pipeline

**Location:** `backend/src/services/audioProcessor.ts`

### Standard Processing Flow (Non-Mastering Presets)

```
┌──────────────────────────────────────────────────────────┐
│                    PROCESSING PIPELINE                    │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  1. GET METADATA (FFprobe)                    [0-10%]   │
│     └─ Duration, sample rate, channels, codec            │
│                                                          │
│  2. ANALYZE INPUT LOUDNESS (FFmpeg ebur128)  [10-20%]   │
│     └─ Integrated LUFS, True Peak, LRA                   │
│                                                          │
│  3. NORMALIZE (ffmpeg-normalize)             [20-90%]   │
│     └─ Apply preset target LUFS and true peak            │
│                                                          │
│  4. VERIFY OUTPUT                            [90-95%]   │
│     └─ Confirm file exists and is valid                  │
│                                                          │
│  5. ANALYZE OUTPUT LOUDNESS                  [95-100%]  │
│     └─ Verify normalization success                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### FFmpeg-Normalize Command

```bash
ffmpeg-normalize {inputPath} \
  -o {outputPath} \
  -t {targetLufs} \
  -tp {truePeak} \
  --loudness-range-target {lra} \
  -c:a {codec} \
  -b:a {bitrate} \
  -f \
  -pr
```

### Output Codec Settings

Output uses the same codec as input. No format conversion occurs.

| Input Format | Output Codec | Notes |
|--------------|--------------|-------|
| WAV | pcm_s24le | 24-bit output |
| MP3 | libmp3lame | 320k bitrate |
| FLAC | flac | Lossless |
| AAC | aac | 256k bitrate |
| OGG | libvorbis | 192k bitrate |

---

## Preset Configurations

**Location:** `backend/src/schemas/presets.ts`

| Preset | Target LUFS | True Peak | LRA | Use Case |
|--------|-------------|-----------|-----|----------|
| **Podcast** | -16 | -1.5 dBTP | 7 LU | Spoken word, interviews |
| **Broadcast** | -23 | -2.0 dBTP | 7 LU | TV/Radio (EBU R128) |
| **YouTube** | -14 | -1.0 dBTP | — | YouTube platform |
| **Streaming** | -14 | -1.0 dBTP | — | Spotify, Apple Music |
| **Mastering** | -9 | -0.5 dBTP | 5 LU | Loud, punchy masters |
| **Audiobook** | -18 | -3.0 dBTP | 8 LU | ACX/Audible compliance |

### API Endpoints

```
GET /api/presets/      → List all presets with configurations
GET /api/presets/:id   → Get specific preset details
```

---

## Mastering Pipeline

**Location:** `backend/src/services/masteringProcessor.ts`

The mastering preset uses a **custom adaptive FFmpeg pipeline** instead of ffmpeg-normalize, with intelligent decisions based on source material analysis.

### Analysis Stage

```
FFmpeg Filter: ebur128=peak=true,astats=metadata=1:measure_overall=1

Extracted Metrics:
├─ Integrated LUFS (I:)
├─ Loudness Range (LRA:)
├─ True Peak (Peak:)
├─ RMS Level dB
├─ Peak Level dB
└─ Crest Factor (Peak - RMS)
```

### Adaptive Decision Tree

```
INPUT ANALYSIS
     │
     ├─── Crest Factor > 10 dB AND LRA > 5 LU?
     │         │
     │         ├─ YES → Enable COMPRESSION
     │         │        acompressor=threshold=-18dB:ratio=2.5:attack=30:release=200
     │         │
     │         └─ NO  → Skip compression
     │
     └─── Integrated LUFS < -12 AND True Peak < -1.5 dBTP?
               │
               ├─ YES → Enable SATURATION
               │        asoftclip=type=tanh
               │
               └─ NO  → Skip saturation
```

### Mastering Filter Chain

```
┌─────────────────────────────────────────────────────────────────┐
│                    MASTERING FILTER CHAIN                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. HIGH-PASS FILTER (always)                                   │
│     highpass=f=25                                                │
│     └─ Remove sub-bass rumble below 25Hz                        │
│                                                                  │
│  2. COMPRESSION (conditional)                                   │
│     acompressor=threshold=-18dB:ratio=2.5:attack=30:release=200 │
│     └─ Tame peaks while preserving transients                   │
│                                                                  │
│  3. SATURATION (conditional)                                    │
│     asoftclip=type=tanh                                          │
│     └─ Add harmonic warmth to thin sources                      │
│                                                                  │
│  4. LOUDNESS NORMALIZATION (always)                             │
│     loudnorm=I=-9:TP=-1.0:LRA=5                                  │
│     └─ Target -9 LUFS with controlled dynamics                  │
│                                                                  │
│  5. TRUE PEAK LIMITER (always)                                  │
│     alimiter=limit=0.93:attack=0.5:release=20                   │
│     └─ Ensure no inter-sample peaks exceed -0.5 dBTP            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Mastering Output Specifications

```
Sample Rate:    48 kHz
Bit Depth:      24-bit (pcm_s24le)
Target LUFS:    -9.0
True Peak Max:  -0.5 dBTP
```

### Quality Control Checks

| Check | Acceptable Range | Action if Failed |
|-------|------------------|------------------|
| Output LUFS | -10.0 to -8.5 | Log warning |
| True Peak | < -0.5 dBTP | Log warning |

### Mastering Output Handling

The mastering pipeline always processes to 24-bit 48kHz WAV internally, then:

- **WAV input**: Output is the mastered 24-bit WAV directly
- **Other formats**: Converted back to original format after mastering

---

## WebSocket Progress Reporting

**Location:** `backend/src/websocket/`

### Connection Management

```
Endpoint:    /ws
Session ID:  ws-{timestamp}-{random}
Heartbeat:   30-second ping interval
Timeout:     60-second inactivity limit
```

### Client → Server Messages

```json
{ "type": "subscribe", "jobId": "abc123" }
{ "type": "unsubscribe", "jobId": "abc123" }
{ "type": "ping" }
```

### Server → Client Messages

```json
// Subscription confirmed
{ "type": "subscribed", "jobId": "abc123" }

// Progress update
{
  "type": "progress",
  "jobId": "abc123",
  "percent": 45,
  "stage": "normalizing"
}

// Job complete
{
  "type": "complete",
  "jobId": "abc123",
  "downloadUrl": "/api/upload/job/abc123/download",
  "duration": 3500,
  "inputLufs": -18.5,
  "outputLufs": -14.0
}

// Job failed
{
  "type": "error",
  "jobId": "abc123",
  "message": "Processing failed",
  "code": "PROCESSING_FAILED"
}
```

### Progress Mapping

| Stage | Progress % |
|-------|------------|
| Job started | 0% |
| Metadata analysis | 10% |
| Loudness analysis | 20% |
| Normalization | 20-90% |
| Output verification | 95% |
| Complete | 100% |

---

## File Cleanup & Retention

**Location:** `backend/src/services/cleanup.ts`

### Two-Tier Cleanup System

#### 1. Age-Based Cleanup (Every 5 Minutes)

```
Retention Period: FILE_RETENTION_MINUTES (default: 15)
Targets:          UPLOAD_DIR and OUTPUT_DIR
Deletes:          Files older than retention period
Skips:            .gitkeep files
```

#### 2. Orphan File Cleanup (Every 10 Minutes)

```
Purpose:          Remove files without corresponding jobs
Minimum Age:      5 minutes (prevents race conditions)
Method:           Extract jobId from filename, check Redis for job
Action:           Delete if job not found in queue
```

### Disk Space Monitoring

```
Warning Level:    80% disk usage
Critical Level:   90% disk usage
Minimum Free:     500MB required for uploads
```

---

## Environment Configuration

**Location:** `backend/src/config/env.ts`

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `REDIS_URL` | redis://localhost:6379 | Redis connection string |
| `UPLOAD_DIR` | ./uploads | Input file storage |
| `OUTPUT_DIR` | ./outputs | Processed file storage |
| `MAX_FILE_SIZE` | 104857600 | Max upload size (100MB) |
| `FILE_RETENTION_MINUTES` | 15 | File auto-delete time |
| `MAX_CONCURRENT_JOBS` | 4 | Parallel processing limit |
| `PROCESSING_TIMEOUT_MS` | 300000 | Job timeout (5 min) |

---

## Error Handling

### Upload Errors

| Code | Description |
|------|-------------|
| `NO_FILE` | No file provided |
| `FILE_TOO_LARGE` | Exceeds MAX_FILE_SIZE |
| `INVALID_FILE_TYPE` | Extension not allowed |
| `INVALID_FORMAT` | Magic bytes mismatch |
| `INSUFFICIENT_STORAGE` | Disk space unavailable |
| `QUEUE_OVERLOADED` | Too many pending jobs |

### Job Errors

| Code | Description |
|------|-------------|
| `JOB_NOT_FOUND` | Job ID doesn't exist |
| `NOT_READY` | File not ready for download |
| `FILE_EXPIRED` | File deleted after retention |
| `PROCESSING_FAILED` | Audio processing error |

### Retry Policy

```
Attempts:     3
Backoff:      Exponential (1s, 2s, 4s)
Final State:  Failed (after all retries exhausted)
```

---

## Current Frontend State

**Important:** The new particle UI (`AudioLevelUI.svelte`) is currently a **demo/simulation only**. It does not connect to the backend.

### What Works (Demo)
- File drag & drop detection
- Simulated progress animation
- Mock report data display
- Batch file visual simulation

### What's Missing (Needs Integration)
- Actual file upload to `/api/upload`
- WebSocket connection for real progress
- Preset selection UI (6 presets)
- Real download functionality
- Rate limit checking
- Error handling from backend

### Design Notes
- **No format conversion UI** - Output format matches input format
- **Auto-detection UI** - The particle sphere UI shows "detected" content type (Podcast, Streaming, etc.) which is a visual feature, not the processing preset

---

## Known Issues / TODO

1. **New UI not integrated**: `AudioLevelUI.svelte` is demo-only, needs WebSocket + API integration to be functional.

---

*Last updated: February 2026*
