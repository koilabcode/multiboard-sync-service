import { Router } from 'express';
import { pingRedis } from '../redis.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

healthRouter.get('/ready', async (_req, res) => {
  const redisReady = await pingRedis();
  const ready = redisReady;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    checks: { redis: redisReady }
  });
});
