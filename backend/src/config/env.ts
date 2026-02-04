import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  UPLOAD_DIR: z.string().default('./uploads'),
  OUTPUT_DIR: z.string().default('./outputs'),
  MAX_FILE_SIZE: z.coerce.number().default(104857600), // 100MB
  FILE_RETENTION_MINUTES: z.coerce.number().default(15),
  MAX_CONCURRENT_JOBS: z.coerce.number().default(4),
  PROCESSING_TIMEOUT_MS: z.coerce.number().default(300000), // 5 minutes
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGINS: z.string().default(''), // Comma-separated list of allowed origins
  // ViSQOL configuration
  VISQOL_PATH: z.string().default('visqol'), // Path to ViSQOL binary
  VISQOL_MODEL_PATH: z.string().default('/usr/share/visqol/model/lattice_tcditugenmeetpackhref_ls2_nl60_lr12_bs2048_learn.005_ep2400_train1_7_raw.tflite'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }

  return result.data;
}

export const env = loadEnv();
