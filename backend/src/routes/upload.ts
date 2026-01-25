import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { fileTypeFromBuffer } from 'file-type';
import { uploadRequestSchema, ALLOWED_MIME_TYPES, type Preset } from '../schemas/upload';
import { addAudioJob, getJobStatus } from '../services/queue';
import { AppError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const upload = new Hono();

const ALLOWED_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.aac', '.ogg', '.m4a']);

upload.post('/', async (c) => {
  const body = await c.req.parseBody();

  const file = body['file'];
  const presetParam = body['preset'];

  if (!file || !(file instanceof File)) {
    throw new AppError(400, 'No file provided', 'NO_FILE');
  }

  // Validate file size
  if (file.size > env.MAX_FILE_SIZE) {
    throw new AppError(400, `File too large. Maximum size is ${env.MAX_FILE_SIZE / 1024 / 1024}MB`, 'FILE_TOO_LARGE');
  }

  // Validate preset
  const presetResult = uploadRequestSchema.safeParse({ preset: presetParam });
  const preset: Preset = presetResult.success ? presetResult.data.preset : 'podcast';

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
  const outputFilename = `${jobId}-output${ext}`;
  const inputPath = join(env.UPLOAD_DIR, inputFilename);
  const outputPath = join(env.OUTPUT_DIR, outputFilename);

  // Ensure directories exist
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  await mkdir(env.OUTPUT_DIR, { recursive: true });

  // Save uploaded file
  await writeFile(inputPath, buffer);

  logger.info({ jobId, filename: file.name, size: file.size, preset }, 'File uploaded');

  // Add job to queue
  await addAudioJob({
    jobId,
    inputPath,
    outputPath,
    preset,
    originalName: file.name,
  });

  return c.json({
    jobId,
    status: 'queued',
    preset,
    originalName: file.name,
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
    result: status.result,
    error: status.failedReason,
  });
});

upload.get('/job/:id/download', async (c) => {
  const jobId = c.req.param('id');
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

  const filename = status.data.originalName.replace(/\.[^/.]+$/, '') + '-normalized' +
    status.result.outputPath.substring(status.result.outputPath.lastIndexOf('.'));

  return new Response(file, {
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

export default upload;
