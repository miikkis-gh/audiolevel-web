import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import presets from '../routes/presets';
import { PRESET_CONFIGS } from '../schemas/presets';

// Create a test app with presets routes
const app = new Hono();
app.route('/api/presets', presets);

describe('Presets API', () => {
  test('GET /api/presets returns all presets', async () => {
    const res = await app.request('/api/presets');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('presets');
    expect(Array.isArray(body.presets)).toBe(true);
    expect(body.presets.length).toBeGreaterThan(0);
  });

  test('All presets have required fields', async () => {
    const res = await app.request('/api/presets');
    const body = await res.json();

    for (const preset of body.presets) {
      expect(preset).toHaveProperty('id');
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('description');
      expect(preset).toHaveProperty('targetLufs');
      expect(preset).toHaveProperty('truePeak');
      expect(typeof preset.id).toBe('string');
      expect(typeof preset.name).toBe('string');
      expect(typeof preset.targetLufs).toBe('number');
      expect(typeof preset.truePeak).toBe('number');
    }
  });

  test('Presets include all expected types', async () => {
    const res = await app.request('/api/presets');
    const body = await res.json();
    const presetIds = body.presets.map((p: { id: string }) => p.id);

    expect(presetIds).toContain('podcast');
    expect(presetIds).toContain('broadcast');
    expect(presetIds).toContain('youtube');
    expect(presetIds).toContain('streaming');
    expect(presetIds).toContain('mastering');
    expect(presetIds).toContain('audiobook');
  });

  test('Preset configs have valid LUFS values', () => {
    for (const [id, config] of Object.entries(PRESET_CONFIGS)) {
      // LUFS should be negative
      expect(config.targetLufs).toBeLessThan(0);
      // True peak should be negative or zero
      expect(config.truePeak).toBeLessThanOrEqual(0);
      // If loudness range is set, it should be positive
      if (config.loudnessRange !== undefined) {
        expect(config.loudnessRange).toBeGreaterThan(0);
      }
    }
  });
});

describe('Preset Configurations', () => {
  test('Podcast preset has correct values', () => {
    const podcast = PRESET_CONFIGS.podcast;
    expect(podcast.targetLufs).toBe(-16);
    expect(podcast.truePeak).toBe(-1.5);
  });

  test('Broadcast preset has correct values', () => {
    const broadcast = PRESET_CONFIGS.broadcast;
    expect(broadcast.targetLufs).toBe(-23);
    expect(broadcast.truePeak).toBe(-2);
  });

  test('YouTube preset has correct values', () => {
    const youtube = PRESET_CONFIGS.youtube;
    expect(youtube.targetLufs).toBe(-14);
    expect(youtube.truePeak).toBe(-1);
  });

  test('Streaming preset has correct values', () => {
    const streaming = PRESET_CONFIGS.streaming;
    expect(streaming.targetLufs).toBe(-14);
    expect(streaming.truePeak).toBe(-1);
  });

  test('Mastering preset has correct values', () => {
    const mastering = PRESET_CONFIGS.mastering;
    expect(mastering.targetLufs).toBe(-9);
    expect(mastering.truePeak).toBe(-0.3);
  });

  test('Audiobook preset has correct values', () => {
    const audiobook = PRESET_CONFIGS.audiobook;
    expect(audiobook.targetLufs).toBe(-18);
    expect(audiobook.truePeak).toBe(-3);
  });
});
