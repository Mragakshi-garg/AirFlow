import dotenv from 'dotenv';
dotenv.config();

import { createPaymentApp } from './app';
import { createLogger } from '@airline/logger';

const logger = createLogger('payment-service');
const PORT = process.env.PAYMENT_SERVICE_PORT || process.env.PORT || 4006;

export * from './payment-repository';
export * from './payment-service';
export * from './payment-controller';
export * from './app';

if (require.main === module) {
  const { app } = createPaymentApp();
  app.listen(PORT, () => {
    logger.info(`Payment Service running on port ${PORT}`);
  });
}
