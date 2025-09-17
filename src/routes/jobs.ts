import { Router } from 'express';
import { addTestJob } from '../queue/index.js';

export const jobsRouter = Router();

jobsRouter.post('/jobs/test', async (_req, res, next) => {
  try {
    const job = await addTestJob({ ts: Date.now() });
    res.status(202).json({ id: job.id });
  } catch (err) {
    next(err);
  }
});
