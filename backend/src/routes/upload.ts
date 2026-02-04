import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import { ALLOWED_MIME_TYPES } from '../schemas/upload';
import { addAudioJob, getJobStatus, canAcceptJob, getQueueStatus } from '../services/queue';
import { AppError } from '../middleware/errorHandler';
import { uploadRateLimiter, statusRateLimiter } from '../middleware/rateLimit';
import { getRateLimitStatus, getClientIp } from '../services/rateLimit';
import { hasEnoughSpace, reserveDiskSpace, releaseDiskSpace } from '../services/diskMonitor';
import { env } from '../config/env';
import { JOB_ID, FILE_HANDLING } from '../config/constants';
import { logger, createChildLogger } from '../utils/logger';

const upload = new Hono();

// Use centralized job ID format from constants
const JOB_ID_REGEX = JOB_ID.REGEX;

const ALLOWED_EXTENSIONS = new Set([
  '.wav', '.mp3', '.flac', '.aac', '.ogg', '.m4a',
  '.aiff', '.aif', '.opus', '.wma', '.webm', '.mka',
  '.caf', '.au', '.snd', '.amr', '.wv', '.ape',
  '.ac3', '.dts', '.mp2',
]);

// Rate limit status endpoint
upload.use('/rate-limit', statusRateLimiter);
upload.get('/rate-limit', async (c) => {
  const clientIp = getClientIp(c.req.raw.headers);
  const status = await getRateLimitStatus(clientIp);

  return c.json({
    limit: 10,
    remaining: status.remaining,
    used: status.count,
    resetAt: status.resetAt,
    windowMs: 15 * 60 * 1000,
  });
});

// Queue status endpoint (for frontend graceful degradation)
upload.use('/queue-status', statusRateLimiter);
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

  if (!file || !(file instanceof File)) {
    throw new AppError(400, 'No file provided', 'NO_FILE');
  }

  // Validate file size
  if (file.size === 0) {
    throw new AppError(400, 'File is empty', 'EMPTY_FILE');
  }
  if (file.size > env.MAX_FILE_SIZE) {
    throw new AppError(400, `File too large. Maximum size is ${env.MAX_FILE_SIZE / 1024 / 1024}MB`, 'FILE_TOO_LARGE');
  }

  // Check disk space
  const diskCheck = await hasEnoughSpace(file.size);
  if (!diskCheck.allowed) {
    throw new AppError(503, diskCheck.reason || 'Insufficient storage', 'INSUFFICIENT_STORAGE');
  }

  // Reserve disk space for this upload (accounts for concurrent uploads)
  reserveDiskSpace(file.size);

  // Check queue capacity (graceful degradation)
  const queueCheck = await canAcceptJob(file.size);
  if (!queueCheck.allowed) {
    releaseDiskSpace(file.size);
    throw new AppError(503, queueCheck.reason || 'Server busy', 'QUEUE_OVERLOADED');
  }

  // Check file extension
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AppError(400, 'Unsupported file type', 'INVALID_FILE_TYPE');
  }

  // Output format matches input format (no conversion)
  const outputFormat = ext.slice(1); // Remove leading dot

  // Generate job ID and file paths
  const jobId = nanoid(12);
  const inputFilename = `${jobId}-input${ext}`;
  const outputFilename = `${jobId}-output.${outputFormat}`;
  const inputPath = join(env.UPLOAD_DIR, inputFilename);
  const outputPath = join(env.OUTPUT_DIR, outputFilename);

  // Ensure directories exist
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  await mkdir(env.OUTPUT_DIR, { recursive: true });

  // Stream file directly to disk (avoids loading entire file into memory)
  await Bun.write(inputPath, file);

  // Validate file type via magic bytes
  const savedFile = Bun.file(inputPath);
  const headerSize = Math.min(FILE_HANDLING.HEADER_SIZE_BYTES, file.size);
  const headerBuffer = Buffer.from(await savedFile.slice(0, headerSize).arrayBuffer());
  const fileType = await fileTypeFromBuffer(headerBuffer);

  // Accept if file-type detects a valid audio/video format:
  // 1. Detected MIME is in our explicit allow list, OR
  // 2. Detected MIME starts with audio/, OR
  // 3. Detected MIME starts with video/ (m4a, webm use video containers)
  // Note: We require file-type detection to succeed - this rejects non-audio files
  // that might have valid extensions but invalid content
  const isValidMime = fileType && (
    ALLOWED_MIME_TYPES.includes(fileType.mime as any) ||
    fileType.mime.startsWith('audio/') ||
    fileType.mime.startsWith('video/')
  );

  if (!isValidMime) {
    // Clean up invalid file and release reserved disk space
    await Bun.write(inputPath, '').catch(() => {});
    try { await import('fs/promises').then(fs => fs.unlink(inputPath)); } catch {}
    releaseDiskSpace(file.size);
    logger.warn({ detectedMime: fileType?.mime, ext }, 'Rejected file with invalid MIME type');
    throw new AppError(400, 'Invalid audio file format', 'INVALID_FORMAT');
  }

  logger.info({ jobId, filename: file.name, size: file.size, outputFormat }, 'File uploaded');

  // Add job to queue with file size for priority calculation
  // Profile detection will automatically determine processing path (mastering vs normalization)
  await addAudioJob({
    jobId,
    inputPath,
    outputPath,
    originalName: file.name,
    fileSize: file.size,
  });

  // Release disk space reservation (file is now written, no longer "pending")
  releaseDiskSpace(file.size);

  return c.json({
    jobId,
    status: 'queued',
    outputFormat,
    originalName: file.name,
    estimatedWaitTime: queueCheck.estimatedWaitTime,
  }, 201);
});

upload.get('/job/:id', async (c) => {
  const jobId = c.req.param('id');

  // Validate jobId format
  if (!JOB_ID_REGEX.test(jobId)) {
    throw new AppError(400, 'Invalid job ID format', 'INVALID_JOB_ID');
  }

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
      detectedProfile: status.result.detectedProfile,
    } : undefined,
    error: status.failedReason,
  });
});

upload.get('/job/:id/download', async (c) => {
  const jobId = c.req.param('id');

  // Validate jobId format
  if (!JOB_ID_REGEX.test(jobId)) {
    throw new AppError(400, 'Invalid job ID format', 'INVALID_JOB_ID');
  }

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
  // Sanitize filename to prevent path traversal and invalid characters
  const sanitizedBaseName = status.data.originalName
    .replace(/\.[^/.]+$/, '') // Remove extension
    .replace(/[^a-z0-9._-]/gi, '_') // Replace unsafe chars
    .replace(/^\.+/, '') // Remove leading dots
    .substring(0, FILE_HANDLING.MAX_FILENAME_LENGTH);
  const outputExt = status.result.outputPath.substring(status.result.outputPath.lastIndexOf('.'));
  const downloadFilename = `${sanitizedBaseName}-normalized${outputExt}`;

  // Log download verification details
  log.info({
    jobId,
    outputPath: status.result.outputPath,
    fileSize,
    contentType,
    downloadFilename,
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
