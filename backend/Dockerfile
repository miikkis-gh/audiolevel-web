FROM oven/bun:1-alpine

# Install FFmpeg, SoX, and ffmpeg-normalize
RUN apk add --no-cache ffmpeg sox python3 py3-pip curl \
    && pip3 install --break-system-packages ffmpeg-normalize

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY . .

# Create upload and output directories
RUN mkdir -p uploads outputs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start the server
CMD ["bun", "run", "src/index.ts"]
