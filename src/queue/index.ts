import { Queue, Worker, QueueEvents, JobsOptions, QueueOptions } from 'bullmq';
import { getRedis } from '../redis.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const connection = getRedis();

const queueOpts: QueueOptions = {
  connection
};

export const syncQueue = new Queue('sync-jobs', queueOpts);
export const queueEvents = new QueueEvents('sync-jobs', { connection });

export function addTestJob(data: Record<string, unknown>, opts?: JobsOptions) {
  return syncQueue.add('test', data, {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
    ...opts
  });
}

export function startWorker() {
  const worker = new Worker(
    'sync-jobs',
    async (job) => {
      if (job.name === 'test') {
        logger.info({ jobId: job.id }, 'Processing test job');
        await new Promise((r) => setTimeout(r, 500));
        return { ok: true };
      }
      return { ok: true };
    },
    {
      connection,
      concurrency: config.maxConcurrentJobs
    }
  );

  worker.on('completed', (job) =>
    logger.info({ jobId: job.id }, 'Job completed')
  );
  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, err }, 'Job failed')
  );

  return worker;
}
