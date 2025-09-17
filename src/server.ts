import express from 'express';
import { healthRouter } from './routes/health.js';
import { jobsRouter } from './routes/jobs.js';

export function createServer() {
  const app = express();
  app.use(express.json());

  app.use('/', healthRouter);
  app.use('/', jobsRouter);

  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err.status === 'number' ? err.status : 500;
    res.status(status).json({ error: 'Internal Server Error' });
  });

  return app;
}
