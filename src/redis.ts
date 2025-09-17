import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null
    } as any);
    client.on('error', (err) => logger.error({ err }, 'Redis error'));
    client.on('connect', () => logger.info('Redis connected'));
    client.on('close', () => logger.warn('Redis connection closed'));
  }
  return client;
}

export async function connectRedis(): Promise<void> {
  const r = getRedis();
  const status = (r as any).status;
  if (status === 'wait') {
    await r.connect();
  }
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

export async function pingRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    const res = await r.ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}
