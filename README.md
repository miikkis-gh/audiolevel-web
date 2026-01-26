# AudioLevel

```
     _             _ _       _                   _
    / \  _   _  __| (_) ___ | |    _____   _____| |
   / _ \| | | |/ _` | |/ _ \| |   / _ \ \ / / _ \ |
  / ___ \ |_| | (_| | | (_) | |__|  __/\ V /  __/ |
 /_/   \_\__,_|\__,_|_|\___/|_____\___| \_/ \___|_|

        Professional Audio Normalization for Everyone
```

A free, web-based audio normalization tool. Upload your audio, pick a preset, and download broadcast-ready files. No login required. No data retained.

---

## Features

- **6 Industry Presets** — Podcast, Broadcast, YouTube, Streaming, Mastering, Audiobook
- **Multi-Format Support** — WAV, MP3, FLAC, AAC, OGG input and output
- **Real-Time Progress** — WebSocket-powered live updates during processing
- **Privacy First** — All files auto-delete after 15 minutes
- **No Account Needed** — Just upload and go
- **Download History** — Session-based tracking of recent conversions

---

## Quick Start

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/miikkis-gh/audiolevel.git
cd audiolevel

# Start all services
docker compose up -d

# Open in browser
open http://localhost:80
```

### Manual Setup

```bash
# Prerequisites: Bun, Redis, FFmpeg, ffmpeg-normalize

# Backend
cd backend
bun install
bun run dev

# Frontend (new terminal)
cd frontend
bun install
bun run dev
```

Visit `http://localhost:5173` for the frontend.

---

## Presets

| Preset | Target LUFS | True Peak | Best For |
|--------|-------------|-----------|----------|
| Podcast | -16 | -1.5 dB | Spoken word, interviews |
| Broadcast | -23 | -2.0 dB | TV/Radio (EBU R128) |
| YouTube | -14 | -1.0 dB | YouTube uploads |
| Streaming | -14 | -1.0 dB | Spotify, Apple Music |
| Mastering | -9 | -0.3 dB | Loud, punchy masters |
| Audiobook | -18 | -3.0 dB | ACX compliance |

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   Frontend  │────▶│   Backend   │
│             │◀────│   (Svelte)  │◀────│   (Hono)    │
└─────────────┘     └─────────────┘     └──────┬──────┘
                           │                   │
                           │ WebSocket         │ Jobs
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │   Nginx     │     │   BullMQ    │
                    │  (optional) │     │   + Redis   │
                    └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │   FFmpeg    │
                                        │  Normalize  │
                                        └─────────────┘
```

---

## Tech Stack

**Backend**
- [Bun](https://bun.sh) — Runtime
- [Hono](https://hono.dev) — Web framework
- [BullMQ](https://bullmq.io) — Job queue
- [Redis](https://redis.io) — State & queue backend
- [FFmpeg](https://ffmpeg.org) + ffmpeg-normalize — Audio processing

**Frontend**
- [Svelte 5](https://svelte.dev) — UI framework
- [Vite](https://vitejs.dev) — Build tool
- [TailwindCSS](https://tailwindcss.com) — Styling

---

## API

### Endpoints

```
POST   /api/upload              Upload audio file
GET    /api/upload/job/:id      Get job status
GET    /api/upload/job/:id/download  Download processed file
GET    /api/presets             List available presets
GET    /api/health              Health check
WS     /ws                      Real-time progress updates
```

### WebSocket Events

```javascript
// Subscribe to job updates
ws.send(JSON.stringify({ type: 'subscribe', jobId: 'abc123' }))

// Receive progress
{ type: 'progress', jobId: 'abc123', percent: 45, stage: 'normalizing' }

// Receive completion
{ type: 'complete', jobId: 'abc123', downloadUrl: '/api/upload/job/abc123/download' }
```

Full API documentation: [`docs/API.md`](docs/API.md)

---

## Configuration

### Environment Variables

```env
# Backend
PORT=3000
REDIS_URL=redis://localhost:6379
UPLOAD_DIR=./uploads
OUTPUT_DIR=./outputs
MAX_FILE_SIZE=104857600          # 100MB
FILE_RETENTION_MINUTES=15
MAX_CONCURRENT_JOBS=4
PROCESSING_TIMEOUT_MS=300000     # 5 minutes

# Frontend
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000/ws
```

---

## Production Deployment

```bash
# Using production compose file
docker compose -f docker-compose.prod.yml up -d
```

Deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

---

## Development

```bash
# Run tests
cd backend && bun test
cd frontend && bun test

# Type checking
cd backend && bun run typecheck
cd frontend && bun run check

# Build for production
cd frontend && bun run build
```

---

## Project Structure

```
audiolevel/
├── backend/
│   ├── src/
│   │   ├── index.ts         # Server entry
│   │   ├── routes/          # API handlers
│   │   ├── services/        # Business logic
│   │   ├── workers/         # Job processors
│   │   └── websocket/       # Real-time handlers
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.svelte       # Main component
│   │   ├── lib/components/  # UI components
│   │   └── stores/          # State management
│   └── package.json
├── docs/                    # Documentation
├── nginx/                   # Nginx config
└── docker-compose.yml
```

---

## Limits

| Resource | Limit |
|----------|-------|
| File size | 100 MB |
| Uploads per hour | 10 per IP |
| File retention | 15 minutes |
| Processing timeout | 5 minutes |
| Concurrent jobs | 4 |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <sub>Built with FFmpeg, Bun, and a love for good audio.</sub>
</p>
