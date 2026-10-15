import dotenv from 'dotenv';
dotenv.config();

import { createSearchApp } from './app';
import { createLogger } from '@airline/logger';

const logger = createLogger('search-service');
const PORT = process.env.SEARCH_SERVICE_PORT || process.env.PORT || 4004;

export * from './search-index';
export * from './cache-service';
export * from './search-service';
export * from './search-controller';
export * from './app';

if (require.main === module) {
  const { app } = createSearchApp();
  app.listen(PORT, () => {
    logger.info(`Flight Search Service running on port ${PORT}`);
  });
}
