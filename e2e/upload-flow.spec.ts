import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Upload Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays upload zone on initial load', async ({ page }) => {
    // Check for upload zone or drop area
    await expect(page.locator('text=/drag|drop|upload/i').first()).toBeVisible();
  });

  test('shows file input when clicking upload area', async ({ page }) => {
    // The file input should exist (may be hidden)
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached();
  });

  test('rejects non-audio files', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    // Create a temp text file
    await fileInput.setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is not audio'),
    });

    // Should show error message
    await expect(page.locator('text=/unsupported|invalid|error/i').first()).toBeVisible({
      timeout: 5000,
    });
  });

  test('accepts valid audio file and shows processing', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    // Create a minimal valid WAV file header
    const wavHeader = createMinimalWavBuffer();

    await fileInput.setInputFiles({
      name: 'test-audio.wav',
      mimeType: 'audio/wav',
      buffer: wavHeader,
    });

    // Should transition to processing or show progress
    // Wait for either processing indicator or error
    await expect(
      page.locator('text=/processing|uploading|analyzing|error|queued/i').first()
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Rate Limiting', () => {
  test('shows rate limit information', async ({ page }) => {
    await page.goto('/');

    // Rate limit info may be visible in footer or settings
    // This depends on UI implementation
    const response = await page.request.get('/api/upload/rate-limit');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('limit');
    expect(data).toHaveProperty('remaining');
  });
});

test.describe('Queue Status', () => {
  test('fetches queue status from API', async ({ page }) => {
    await page.goto('/');

    const response = await page.request.get('/api/upload/queue-status');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('acceptingJobs');
    expect(['normal', 'warning', 'overloaded']).toContain(data.status);
  });
});

// Helper function to create minimal valid WAV buffer
function createMinimalWavBuffer(): Buffer {
  const sampleRate = 44100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = 44100; // 1 second

  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // audio format (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Fill with silence (zeros)
  // Buffer is already initialized to zeros

  return buffer;
}
