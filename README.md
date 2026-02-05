# AudioLevel

Web-based audio normalization tool. LUFS loudness normalization for music, podcasts, and speech.

Drop files, get broadcast-ready audio. No signup, no BS.

Automatically detects content type (music, speech, podcast), runs multiple processing strategies in parallel, picks the best result. Files delete after 15 minutes.

## Run it

```bash
git clone https://github.com/miikkis-gh/audiolevel-web.git
cd audiolevel-web
docker compose up -d
```

Open http://localhost:8081

## How it works

1. Upload analyzes your audio (loudness, dynamics, spectral content)
2. Classifies as music/speech/podcast based on silence ratio, spectral flatness, etc.
3. Generates 4-6 processing candidates (conservative → aggressive)
4. Runs them in parallel through FFmpeg
5. Scores each result, picks the winner
6. You download

Conservative processing wins ties. Less is more.

## Stack

- **FFmpeg** + **SoX** - audio processing and analysis
- **ViSQOL** - perceptual quality scoring (optional)
- **Bun** + **Hono** - backend
- **SvelteKit** - frontend
- **Redis** + **BullMQ** - job queue
- **WebGL** - that sphere thing

## Config

Environment variables in `docker-compose.yml`:

```
MAX_FILE_SIZE=104857600      # 100MB
FILE_RETENTION_MINUTES=15
MAX_CONCURRENT_JOBS=4
DISCORD_WEBHOOK_URL=...      # optional, for feedback
```

## Dev

```bash
# backend
cd backend && bun install && bun run dev

# frontend
cd frontend && bun install && bun run dev
```

Tests: `cd backend && bun test`

## License

Apache-2.0

---

made by [miikkis](https://github.com/miikkis-gh)
