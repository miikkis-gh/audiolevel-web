# CLAUDE.md - AudioLevel Project

## Project Overview

AudioLevel is a free, web-based audio normalization tool. Users upload audio files, select a preset, and download processed files. No login required. All files auto-delete after 15 minutes.

## Tech Stack

**Backend:** Bun + Hono + BullMQ + Redis + Zod + node-cron + FFmpeg/ffmpeg-normalize  
**Frontend:** Svelte 5 + Vite + TailwindCSS + Wavesurfer.js + WebSocket API  
**Infrastructure:** Docker + Docker Compose + Nginx (optional)

## Project Structure

```
audiolevel/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Hono server entry point
│   │   ├── routes/           # API route handlers
│   │   ├── services/         # Business logic (audio processing, queue)
│   │   ├── workers/          # BullMQ job processors
│   │   ├── schemas/          # Zod validation schemas
│   │   ├── utils/            # Helpers (ffmpeg commands, file handling)
│   │   └── websocket/        # WebSocket handlers
│   ├── uploads/              # Temporary upload storage
│   ├── outputs/              # Processed files
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── lib/              # Svelte components
│   │   ├── routes/           # Page components
│   │   └── stores/           # Svelte stores
│   └── package.json
├── docker-compose.yml
└── MILESTONES.md
```

## Common Commands

```bash
# Install dependencies
cd backend && bun install
cd frontend && bun install

# Run development servers
cd backend && bun run dev
cd frontend && bun run dev

# Docker development
docker compose up -d

# Run tests
cd backend && bun test
cd frontend && bun test

# Type checking
cd backend && bun run typecheck
cd frontend && bun run check

# Build for production
cd frontend && bun run build
```

## Key Implementation Details

### Audio Processing Presets

| Preset | Target LUFS | True Peak | Use Case |
|--------|-------------|-----------|----------|
| Podcast | -16 | -1.5 dB | Spoken word podcasts |
| Broadcast | -23 | -2 dB | TV/Radio compliance |
| YouTube | -14 | -1 dB | YouTube uploads |
| Streaming | -14 | -1 dB | Spotify, Apple Music |
| Mastering | -9 | -0.3 dB | Loud masters |
| Audiobook | -18 | -3 dB | ACX compliance |

### FFmpeg Normalization Command Pattern

```bash
ffmpeg-normalize input.wav -o output.wav -t -16 -tp -1.5 --loudness-range-target 7
```

### API Endpoints

```
POST   /api/upload              # Upload audio file
GET    /api/job/:id             # Get job status
GET    /api/job/:id/download    # Download processed file
GET    /api/presets             # List available presets
GET    /api/health              # Health check
WS     /ws                      # WebSocket for progress updates
```

### WebSocket Events

```typescript
// Server → Client
{ type: 'progress', jobId: string, percent: number }
{ type: 'complete', jobId: string, downloadUrl: string }
{ type: 'error', jobId: string, message: string }

// Client → Server
{ type: 'subscribe', jobId: string }
```

### File Validation Rules

- Max size: 100MB
- Allowed types: audio/wav, audio/mp3, audio/flac, audio/aac, audio/ogg, audio/mpeg
- Validate via magic bytes, not just extension
- Reject files that FFmpeg cannot decode

### Rate Limiting

- 10 uploads per IP per hour
- Use Redis for tracking
- Return 429 with retry-after header

## Environment Variables

```env
# Backend
PORT=3000
REDIS_URL=redis://localhost:6379
UPLOAD_DIR=./uploads
OUTPUT_DIR=./outputs
MAX_FILE_SIZE=104857600
FILE_RETENTION_MINUTES=15
MAX_CONCURRENT_JOBS=4
PROCESSING_TIMEOUT_MS=300000

# Frontend
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000/ws
```

## Code Style Guidelines

- Use TypeScript strict mode
- Prefer async/await over callbacks
- Use Zod for all input validation
- Handle all error cases explicitly
- Log errors with context (job ID, file info)
- Use descriptive variable names
- Keep functions small and focused

## Testing Approach

- Unit tests for audio processing utilities
- Integration tests for API endpoints
- Use test fixtures for sample audio files
- Mock FFmpeg for fast unit tests
- Test WebSocket reconnection logic

## Common Gotchas

1. **FFmpeg path:** Ensure FFmpeg and ffmpeg-normalize are in PATH inside Docker
2. **File permissions:** Upload/output directories need write access
3. **Redis connection:** BullMQ needs Redis 6.2+ for streams
4. **WebSocket upgrade:** Hono needs explicit upgrade handling
5. **CORS:** Configure for local dev (localhost:5173 → localhost:3000)
6. **Cleanup race condition:** Don't delete files while download is in progress

## Current Milestone

See MILESTONES.md for full project timeline. Start with Phase 1: Foundation & Setup.

## Architecture Decisions

- **No database:** Redis handles all state; files are ephemeral
- **Session-based:** Use session cookies for download history, no auth
- **Job queue:** BullMQ for reliability, retries, and progress tracking
- **Sandboxed FFmpeg:** Resource limits prevent abuse
- **Separate directories:** Uploads isolated from processed outputs