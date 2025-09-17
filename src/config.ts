import 'dotenv/config';

function reqEnv(name: string, def?: string) {
  const v = process.env[name] ?? def;
  if (v === undefined) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8080),
  apiKey: process.env.API_KEY ?? '',
  redisUrl: reqEnv('REDIS_URL', 'redis://localhost:6379'),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
  jobTimeoutMinutes: Number(process.env.JOB_TIMEOUT_MINUTES ?? 60)
};
