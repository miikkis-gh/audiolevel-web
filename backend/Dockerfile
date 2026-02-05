# AudioLevel Backend
#
# Lightweight image with FFmpeg and SoX for audio processing.
# ViSQOL is disabled - using spectral analysis fallback for quality scoring.

FROM oven/bun:1-debian AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    sox \
    python3 \
    python3-pip \
    curl \
    libsndfile1 \
    && pip3 install --break-system-packages ffmpeg-normalize \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY . .

# Create directories
RUN mkdir -p uploads outputs data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start server
CMD ["bun", "run", "src/index.ts"]
