# AudioLevel Deployment Guide

## Prerequisites

- Docker 20.10+ and Docker Compose 2.0+
- At least 2GB RAM
- At least 10GB disk space
- Ports 80 (or 443 for HTTPS) available

## Quick Start

### Development

```bash
# Clone the repository
git clone <repository-url>
cd audiolevel

# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Access the application
# Frontend: http://localhost:5173
# Backend API: http://localhost:3000
```

### Production

```bash
# Build and start production services
docker compose -f docker-compose.prod.yml up -d --build

# The application will be available on port 80
```

## Environment Variables

### Backend

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| REDIS_URL | redis://localhost:6379 | Redis connection URL |
| UPLOAD_DIR | ./uploads | Directory for uploaded files |
| OUTPUT_DIR | ./outputs | Directory for processed files |
| MAX_FILE_SIZE | 104857600 | Maximum file size in bytes (100MB) |
| FILE_RETENTION_MINUTES | 15 | How long to keep files |
| MAX_CONCURRENT_JOBS | 4 | Parallel processing jobs |
| PROCESSING_TIMEOUT_MS | 300000 | Processing timeout (5 min) |
| LOG_LEVEL | info | Logging level (debug, info, warn, error) |

### Frontend (Build-time)

| Variable | Default | Description |
|----------|---------|-------------|
| VITE_API_URL | (empty) | Backend API URL (relative by default) |
| VITE_WS_URL | (empty) | WebSocket URL (relative by default) |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│                 │     │                 │     │                 │
│    Frontend     │────▶│     Nginx       │────▶│    Backend      │
│   (Svelte 5)    │     │  (Reverse Proxy)│     │ (Bun + Hono)    │
│                 │     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                        ┌─────────────────┐     ┌─────────────────┐
                        │                 │     │                 │
                        │     Redis       │◀────│   BullMQ        │
                        │   (Job Queue)   │     │   (Worker)      │
                        │                 │     │                 │
                        └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │                 │
                                                │    FFmpeg       │
                                                │  (Processing)   │
                                                │                 │
                                                └─────────────────┘
```

## Production Deployment Options

### Option 1: Docker Compose (Recommended for Single Server)

1. Configure environment:
```bash
cp .env.example .env
# Edit .env with your settings
```

2. Build and start:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

3. Set up SSL (optional but recommended):
```bash
# Edit nginx/nginx.conf to enable SSL sections
# Place your certificates in nginx/ssl/
docker compose -f docker-compose.prod.yml restart
```

### Option 2: Manual Deployment

1. **Install dependencies**:
```bash
# Install FFmpeg
apt-get update && apt-get install -y ffmpeg

# Install ffmpeg-normalize
pip3 install ffmpeg-normalize

# Install Bun
curl -fsSL https://bun.sh/install | bash
```

2. **Set up Redis**:
```bash
# Using Docker
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Or install natively
apt-get install redis-server
```

3. **Build frontend**:
```bash
cd frontend
bun install
bun run build
```

4. **Start backend**:
```bash
cd backend
bun install
bun run src/index.ts
```

5. **Serve frontend with Nginx**:
```bash
# Copy frontend/dist to /var/www/audiolevel
# Configure Nginx with frontend/nginx.conf as reference
```

## Health Checks

Monitor these endpoints:

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| GET /api/health | Overall health | 200 OK |
| GET /api/health/ready | Readiness check | 200 OK |
| GET /api/health/summary | Detailed status | 200 OK |

Example monitoring script:
```bash
#!/bin/bash
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health)
if [ "$STATUS" != "200" ]; then
  echo "ALERT: AudioLevel is unhealthy (HTTP $STATUS)"
  # Send alert notification
fi
```

## Scaling

### Horizontal Scaling

1. **Multiple Backend Instances**:
   - Run multiple backend containers
   - Use a load balancer (Nginx, HAProxy)
   - All instances share the same Redis

2. **Redis Clustering**:
   - For high availability, use Redis Sentinel or Cluster

### Resource Limits

Recommended limits per component:

| Service | CPU | Memory |
|---------|-----|--------|
| Backend | 2 cores | 2GB |
| Frontend/Nginx | 0.5 cores | 128MB |
| Redis | 0.5 cores | 256MB |

## Troubleshooting

### Common Issues

**1. Redis Connection Refused**
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
Solution: Ensure Redis is running and accessible.

**2. FFmpeg Not Found**
```
ffmpeg-normalize: command not found
```
Solution: Install ffmpeg-normalize: `pip3 install ffmpeg-normalize`

**3. File Upload Fails**
```
Error: File too large
```
Solution: Check `MAX_FILE_SIZE` and Nginx `client_max_body_size`

**4. WebSocket Connection Fails**
Solution: Ensure Nginx is configured for WebSocket upgrade:
```nginx
location /ws {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
}
```

**5. Disk Space Full**
Solution: Reduce `FILE_RETENTION_MINUTES` or add disk space.

### Logs

View logs for debugging:
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend

# Last 100 lines
docker compose logs --tail=100 backend
```

### Cleanup

Force cleanup of old files:
```bash
# Enter backend container
docker exec -it audiolevel-backend sh

# Files older than 15 minutes are auto-deleted
# For manual cleanup:
find /app/uploads -mmin +15 -delete
find /app/outputs -mmin +15 -delete
```

## Security Checklist

- [ ] Use HTTPS in production
- [ ] Set strong Redis password (if exposed)
- [ ] Configure firewall (only expose ports 80/443)
- [ ] Enable rate limiting
- [ ] Set appropriate file size limits
- [ ] Review Nginx security headers
- [ ] Keep Docker images updated
- [ ] Monitor disk usage
- [ ] Set up log rotation

## Backup & Recovery

AudioLevel is stateless by design - all files are temporary. No backup is needed for file data.

For configuration backup:
```bash
# Backup docker-compose and env files
tar -czvf audiolevel-config.tar.gz docker-compose.prod.yml .env nginx/
```
