import { createServer } from './server.js';
import { connectRedis, disconnectRedis } from './redis.js';
import { startWorker } from './queue/index.js';
import { config } from './config.js';
import { logger } from './logger.js';

async function main() {
  await connectRedis();
  const app = createServer();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Sync service listening');
  });

  const worker = startWorker();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    server.close();
    await worker.close();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
