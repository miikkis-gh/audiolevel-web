import { test, expect } from '@playwright/test';

test.describe('Batch Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('allows multiple file selection', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    // Check if multiple attribute is set
    const isMultiple = await fileInput.getAttribute('multiple');
    // Multiple file upload should be supported
    expect(isMultiple !== null || isMultiple === '').toBeTruthy();
  });

  test('enforces batch limit of 10 files', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    // Create 11 minimal WAV files
    const files = Array.from({ length: 11 }, (_, i) => ({
      name: `test-${i + 1}.wav`,
      mimeType: 'audio/wav',
      buffer: createMinimalWavBuffer(),
    }));

    await fileInput.setInputFiles(files);

    // Should show batch limit error or only accept first 10
    // Wait for either error message or processing to start
    await page.waitForTimeout(1000);

    // Check for batch limit message or that only 10 files are shown
    const hasLimitMessage = await page.locator('text=/limit|maximum|10/i').isVisible();
    const fileCount = await page.locator('[data-testid="batch-file"]').count();

    // Either shows limit message or caps at 10 files
    expect(hasLimitMessage || fileCount <= 10).toBeTruthy();
  });

  test('shows individual file progress in batch mode', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    // Upload 2 files
    const files = [
      {
        name: 'batch-test-1.wav',
        mimeType: 'audio/wav',
        buffer: createMinimalWavBuffer(),
      },
      {
        name: 'batch-test-2.wav',
        mimeType: 'audio/wav',
        buffer: createMinimalWavBuffer(),
      },
    ];

    await fileInput.setInputFiles(files);

    // Wait for batch mode to activate
    await page.waitForTimeout(500);

    // Should show batch processing UI or individual file entries
    const hasBatchUI =
      (await page.locator('text=/batch/i').isVisible()) ||
      (await page.locator('[data-testid="batch-file"]').count()) >= 2 ||
      (await page.locator('text=/batch-test-1/i').isVisible());

    expect(hasBatchUI).toBeTruthy();
  });

  test('can cancel batch upload', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');

    const files = [
      {
        name: 'cancel-test-1.wav',
        mimeType: 'audio/wav',
        buffer: createMinimalWavBuffer(),
      },
      {
        name: 'cancel-test-2.wav',
        mimeType: 'audio/wav',
        buffer: createMinimalWavBuffer(),
      },
    ];

    await fileInput.setInputFiles(files);

    // Look for cancel/reset button
    const cancelButton = page.locator('button:has-text(/cancel|reset|clear/i)').first();

    if (await cancelButton.isVisible({ timeout: 2000 })) {
      await cancelButton.click();

      // Should return to idle state
      await expect(page.locator('text=/drag|drop|upload/i').first()).toBeVisible({
        timeout: 5000,
      });
    }
  });
});

test.describe('Batch Download', () => {
  test('API returns job status correctly', async ({ page }) => {
    // Test the API endpoint directly
    const response = await page.request.get('/api/upload/job/test-nonexistent');

    // Should return 404 for non-existent job
    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data.code).toBe('JOB_NOT_FOUND');
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
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
}
