import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import { uploadRequestSchema, ALLOWED_MIME_TYPES, type Preset } from '../schemas/upload';
import { addAudioJob, getJobStatus, canAcceptJob, getQueueStatus } from '../services/queue';
import { AppError } from '../middleware/errorHandler';
import { uploadRateLimiter } from '../middleware/rateLimit';
import { getRateLimitStatus, getClientIp } from '../services/rateLimit';
import { hasEnoughSpace } from '../services/diskMonitor';
import { env } from '../config/env';
import { logger, createChildLogger } from '../utils/logger';

const upload = new Hono();

const ALLOWED_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.aac', '.ogg', '.m4a']);
const ALLOWED_OUTPUT_FORMATS = new Set(['wav', 'mp3', 'flac', 'aac', 'ogg']);

// Rate limit status endpoint (no rate limiting applied)
upload.get('/rate-limit', async (c) => {
  const clientIp = getClientIp(c.req.raw.headers);
  const status = await getRateLimitStatus(clientIp);

  return c.json({
    limit: 10,
    remaining: status.remaining,
    used: status.count,
    resetAt: status.resetAt,
    windowMs: 60 * 60 * 1000,
  });
});

// Queue status endpoint (for frontend graceful degradation)
upload.get('/queue-status', async (c) => {
  const status = await getQueueStatus();

  return c.json({
    status: status.status,
    acceptingJobs: status.acceptingJobs,
    estimatedWaitTime: status.estimatedWaitTime,
    waiting: status.waiting,
    active: status.active,
  });
});

// Apply rate limiting to upload endpoint
upload.use('/', uploadRateLimiter);

upload.post('/', async (c) => {
  const body = await c.req.parseBody();

  const file = body['file'];
  const presetParam = body['preset'];
  const outputFormatParam = body['outputFormat'];

  if (!file || !(file instanceof File)) {
    throw new AppError(400, 'No file provided', 'NO_FILE');
  }

  // Validate file size
  if (file.size > env.MAX_FILE_SIZE) {
    throw new AppError(400, `File too large. Maximum size is ${env.MAX_FILE_SIZE / 1024 / 1024}MB`, 'FILE_TOO_LARGE');
  }

  // Check disk space
  const diskCheck = await hasEnoughSpace(file.size);
  if (!diskCheck.allowed) {
    throw new AppError(503, diskCheck.reason || 'Insufficient storage', 'INSUFFICIENT_STORAGE');
  }

  // Check queue capacity (graceful degradation)
  const queueCheck = await canAcceptJob(file.size);
  if (!queueCheck.allowed) {
    throw new AppError(503, queueCheck.reason || 'Server busy', 'QUEUE_OVERLOADED');
  }

  // Validate preset
  const presetResult = uploadRequestSchema.safeParse({ preset: presetParam });
  const preset: Preset = presetResult.success ? presetResult.data.preset : 'podcast';

  // Validate output format
  const outputFormat = typeof outputFormatParam === 'string' && ALLOWED_OUTPUT_FORMATS.has(outputFormatParam)
    ? outputFormatParam
    : 'wav';

  // Check file extension
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AppError(400, 'Unsupported file type', 'INVALID_FILE_TYPE');
  }

  // Validate file type via magic bytes
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const fileType = await fileTypeFromBuffer(buffer);

  if (!fileType || !ALLOWED_MIME_TYPES.includes(fileType.mime as any)) {
    throw new AppError(400, 'Invalid audio file format', 'INVALID_FORMAT');
  }

  // Generate job ID and save file
  const jobId = nanoid(12);
  const inputFilename = `${jobId}-input${ext}`;
  const outputFilename = `${jobId}-output.${outputFormat}`;
  const inputPath = join(env.UPLOAD_DIR, inputFilename);
  const outputPath = join(env.OUTPUT_DIR, outputFilename);

  // Ensure directories exist
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  await mkdir(env.OUTPUT_DIR, { recursive: true });

  // Save uploaded file
  await writeFile(inputPath, buffer);

  logger.info({ jobId, filename: file.name, size: file.size, preset, outputFormat }, 'File uploaded');

  // Add job to queue with file size for priority calculation
  await addAudioJob({
    jobId,
    inputPath,
    outputPath,
    preset,
    originalName: file.name,
    fileSize: file.size,
  });

  return c.json({
    jobId,
    status: 'queued',
    preset,
    outputFormat,
    originalName: file.name,
    estimatedWaitTime: queueCheck.estimatedWaitTime,
  }, 201);
});

upload.get('/job/:id', async (c) => {
  const jobId = c.req.param('id');
  const status = await getJobStatus(jobId);

  if (!status) {
    throw new AppError(404, 'Job not found', 'JOB_NOT_FOUND');
  }

  return c.json({
    jobId: status.id,
    status: status.state,
    progress: status.progress,
    result: status.result ? {
      success: status.result.success,
      outputPath: status.result.outputPath,
      duration: status.result.duration,
      processingType: status.result.processingType,
      masteringDecisions: status.result.masteringDecisions,
      filterChain: status.result.filterChain,
      inputAnalysis: status.result.inputAnalysis,
      outputAnalysis: status.result.outputAnalysis,
    } : undefined,
    error: status.failedReason,
  });
});

upload.get('/job/:id/download', async (c) => {
  const jobId = c.req.param('id');
  const log = createChildLogger({ jobId, route: 'download' });
  const status = await getJobStatus(jobId);

  if (!status) {
    throw new AppError(404, 'Job not found', 'JOB_NOT_FOUND');
  }

  if (status.state !== 'completed' || !status.result?.outputPath) {
    throw new AppError(400, 'File not ready for download', 'NOT_READY');
  }

  const file = Bun.file(status.result.outputPath);
  const exists = await file.exists();

  if (!exists) {
    throw new AppError(404, 'File no longer available', 'FILE_EXPIRED');
  }

  const fileSize = file.size;
  const contentType = file.type || 'application/octet-stream';
  const downloadFilename = status.data.originalName.replace(/\.[^/.]+$/, '') + '-normalized' +
    status.result.outputPath.substring(status.result.outputPath.lastIndexOf('.'));

  // Log download verification details
  log.info({
    jobId,
    outputPath: status.result.outputPath,
    fileSize,
    contentType,
    downloadFilename,
    preset: status.data?.preset,
    processingType: status.result.processingType,
    masteringDecisions: status.result.masteringDecisions,
    filterChain: status.result.filterChain,
  }, 'Serving download file');

  return new Response(file, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${downloadFilename}"`,
      'Content-Length': String(fileSize),
    },
  });
});

export default upload;
