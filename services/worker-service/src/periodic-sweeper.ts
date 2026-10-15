import { InventoryRepository } from '@airline/inventory-service';
import { BookingRepository } from '@airline/booking-service';
import { createEvent, KAFKA_TOPICS, EventEnvelope } from '@airline/events';
import { createLogger } from '@airline/logger';

const logger = createLogger('periodic-sweeper');

export interface SweeperResult {
  expiredSeatsCleaned: number;
  expiredBookingsCleaned: number;
  durationMs: number;
}

export class PeriodicSweeper {
  private timer: NodeJS.Timeout | null = null;
  public metrics = {
    totalSweepsRun: 0,
    totalExpiredSeatsCleaned: 0,
    totalExpiredBookingsCleaned: 0,
  };

  constructor(
    private inventoryRepo: InventoryRepository,
    private bookingRepo: BookingRepository,
    private eventDispatcher?: (event: EventEnvelope) => Promise<void>
  ) {}

  /**
   * Run a full sweep across both seat holds and pending bookings.
   */
  async runSweepNow(): Promise<SweeperResult> {
    const start = Date.now();
    logger.debug('Starting periodic sweep of expired holds and bookings');

    // 1. Sweep expired seat holds
    const expiredSeatsCleaned = await this.sweepExpiredSeatHolds();

    // 2. Sweep expired pending bookings
    const expiredBookingsCleaned = await this.sweepExpiredBookings();

    this.metrics.totalSweepsRun++;
    this.metrics.totalExpiredSeatsCleaned += expiredSeatsCleaned;
    this.metrics.totalExpiredBookingsCleaned += expiredBookingsCleaned;

    const durationMs = Date.now() - start;
    logger.info('Periodic sweep completed', {
      expiredSeatsCleaned,
      expiredBookingsCleaned,
      durationMs,
    });

    return {
      expiredSeatsCleaned,
      expiredBookingsCleaned,
      durationMs,
    };
  }

  /**
   * Sweep and release all seat holds that exceeded their TTL.
   */
  async sweepExpiredSeatHolds(): Promise<number> {
    try {
      const released = await this.inventoryRepo.releaseExpiredHolds();
      return released;
    } catch (err) {
      logger.error('Error sweeping expired seat holds', err);
      return 0;
    }
  }

  /**
   * Sweep and transition all pending bookings that exceeded their expiresAt deadline.
   */
  async sweepExpiredBookings(): Promise<number> {
    try {
      const expiredBookings = await this.bookingRepo.getExpiredPendingBookings();
      let cleaned = 0;

      for (const booking of expiredBookings) {
        // 1. Mark booking EXPIRED
        await this.bookingRepo.updateBookingStatus(booking.id, 'EXPIRED');

        // 2. Release seat in inventory
        await this.inventoryRepo.releaseExpiredHolds(booking.flightId);

        // 3. Dispatch BOOKING_EXPIRED event
        if (this.eventDispatcher) {
          const event = createEvent(
            KAFKA_TOPICS.BOOKING_EXPIRED,
            'BookingExpired',
            'worker-service',
            {
              bookingId: booking.id,
              bookingReference: booking.bookingReference,
              flightId: booking.flightId,
              seatId: booking.seatId,
              userId: booking.userId,
            }
          );
          await this.eventDispatcher(event).catch(() => {});
        }

        cleaned++;
      }

      return cleaned;
    } catch (err) {
      logger.error('Error sweeping expired bookings', err);
      return 0;
    }
  }

  /**
   * Start periodic timer in the background.
   */
  start(intervalMs: number = 30000): void {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      await this.runSweepNow().catch((err) => {
        logger.error('Error in scheduled periodic sweep', err);
      });
    }, intervalMs);

    logger.info('Periodic Sweeper started', { intervalMs });
  }

  /**
   * Stop periodic timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Periodic Sweeper stopped');
    }
  }
}
