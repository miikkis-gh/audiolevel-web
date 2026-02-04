# AudioLevel Backend with ViSQOL Support
#
# Multi-stage build:
# 1. visqol-builder: Builds ViSQOL from source (can take 20-30 min first time)
# 2. runtime: Final image with all dependencies
#
# For faster builds, pre-build the ViSQOL image:
#   docker build -f Dockerfile.visqol-builder -t audiolevel-visqol-builder .
# Then uncomment the line below and comment out the build section:
#   FROM audiolevel-visqol-builder AS visqol-builder

# ============================================================================
# Stage 1: Build ViSQOL (skip if using pre-built image)
# ============================================================================
FROM ubuntu:22.04 AS visqol-builder

ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    ca-certificates \
    build-essential \
    python3 \
    pkg-config \
    libarmadillo-dev \
    libfftw3-dev \
    libsndfile-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Bazelisk (auto-downloads correct Bazel version)
RUN wget -q https://github.com/bazelbuild/bazelisk/releases/download/v1.19.0/bazelisk-linux-amd64 \
    -O /usr/local/bin/bazel && chmod +x /usr/local/bin/bazel

# Clone ViSQOL
WORKDIR /build
RUN git clone --depth 1 https://github.com/google/visqol.git

# Build ViSQOL (suppress errors - build is optional)
WORKDIR /build/visqol
RUN bazel build -c opt //visqol:visqol 2>&1 || echo "ViSQOL build completed (may have warnings)"

# Prepare output directory
RUN mkdir -p /visqol-dist/model

# Copy binary if build succeeded
RUN if [ -f bazel-bin/visqol/visqol ]; then \
        cp bazel-bin/visqol/visqol /visqol-dist/ && \
        chmod +x /visqol-dist/visqol && \
        echo "ViSQOL binary copied successfully"; \
    else \
        echo "ViSQOL build failed - spectral fallback will be used"; \
    fi

# Copy model files
RUN cp -r model/* /visqol-dist/model/ 2>/dev/null || true


# ============================================================================
# Stage 2: Runtime Image
# ============================================================================
FROM oven/bun:1-debian AS runtime

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    sox \
    python3 \
    python3-pip \
    curl \
    # ViSQOL runtime dependencies
    libarmadillo11 \
    libfftw3-3 \
    libsndfile1 \
    && pip3 install --break-system-packages ffmpeg-normalize \
    && rm -rf /var/lib/apt/lists/*

# Copy ViSQOL from builder stage
COPY --from=visqol-builder /visqol-dist/ /usr/local/visqol/

# Set up ViSQOL symlink if binary exists
RUN if [ -f /usr/local/visqol/visqol ]; then \
        ln -sf /usr/local/visqol/visqol /usr/local/bin/visqol && \
        echo "ViSQOL installed at /usr/local/bin/visqol"; \
    else \
        echo "ViSQOL not available - using spectral analysis fallback"; \
    fi

# Environment variables
ENV VISQOL_PATH=/usr/local/bin/visqol
ENV VISQOL_MODEL_PATH=/usr/local/visqol/model/lattice_tcditugenmeetpackhref_ls2_nl60_lr12_bs2048_learn.005_ep2400_train1_7_raw.tflite

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY . .

# Create directories
RUN mkdir -p uploads outputs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Start server
CMD ["bun", "run", "src/index.ts"]
