import dotenv from 'dotenv';
dotenv.config();

import { createInventoryApp } from './app';
import { createLogger } from '@airline/logger';

const logger = createLogger('inventory-service');
const PORT = process.env.INVENTORY_SERVICE_PORT || process.env.PORT || 4003;

export * from './redlock';
export * from './inventory-repository';
export * from './inventory-service';
export * from './inventory-controller';
export * from './app';

if (require.main === module) {
  const { app } = createInventoryApp();
  app.listen(PORT, () => {
    logger.info(`Inventory Service running on port ${PORT}`);
  });
}
