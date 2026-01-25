import { Hono } from 'hono';
import { PRESET_CONFIGS } from '../schemas/presets';
import { PRESETS } from '../schemas/upload';

const presets = new Hono();

presets.get('/', (c) => {
  const presetList = PRESETS.map((key) => ({
    id: key,
    ...PRESET_CONFIGS[key],
  }));

  return c.json({ presets: presetList });
});

presets.get('/:id', (c) => {
  const id = c.req.param('id') as keyof typeof PRESET_CONFIGS;

  if (!PRESET_CONFIGS[id]) {
    return c.json({ error: 'Preset not found' }, 404);
  }

  return c.json({
    id,
    ...PRESET_CONFIGS[id],
  });
});

export default presets;
