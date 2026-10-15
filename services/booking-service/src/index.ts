import dotenv from 'dotenv';
dotenv.config();

import { createBookingApp } from './app';
import { createLogger } from '@airline/logger';

const logger = createLogger('booking-service');
const PORT = process.env.BOOKING_SERVICE_PORT || process.env.PORT || 4005;

export * from './booking-repository';
export * from './outbox-relay';
export * from './saga-orchestrator';
export * from './booking-service';
export * from './booking-controller';
export * from './app';

if (require.main === module) {
  const { app } = createBookingApp();
  app.listen(PORT, () => {
    logger.info(`Booking Service running on port ${PORT}`);
  });
}
