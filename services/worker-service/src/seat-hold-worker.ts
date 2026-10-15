import { InventoryService } from '@airline/inventory-service';
import { createEvent, KAFKA_TOPICS, EventEnvelope } from '@airline/events';
import { createLogger } from '@airline/logger';
import { IJobQueue, GenericJob } from './job-queue';

const logger = createLogger('seat-hold-worker');

export interface SeatHoldExpiryJobData {
  seatId: string;
  userId: string;
  flightId: string;
  heldUntil: string;
}

export class SeatHoldExpiryWorker {
  public metrics = {
    jobsProcessed: 0,
    autoReleasedCount: 0,
    skippedCount: 0,
    errorsCount: 0,
  };

  constructor(
    private queue: IJobQueue<SeatHoldExpiryJobData>,
    private inventoryService: InventoryService,
    private eventDispatcher?: (event: EventEnvelope) => Promise<void>
  ) {
    this.queue.process(this.handleExpiryJob.bind(this));
  }

  /**
   * Schedules a delayed auto-expiration job for a newly held seat.
   */
  async scheduleExpiry(
    seatId: string,
    userId: string,
    flightId: string,
    delayMs: number = 600000 // default 600 seconds (10 minutes)
  ): Promise<void> {
    const jobId = `hold-expiry-${seatId}`;
    const heldUntil = new Date(Date.now() + delayMs).toISOString();

    await this.queue.add(
      'expire-seat-hold',
      {
        seatId,
        userId,
        flightId,
        heldUntil,
      },
      {
        delay: delayMs,
        jobId,
        removeOnComplete: true,
      }
    );

    logger.debug('Scheduled seat hold expiry job', { seatId, userId, delayMs, jobId });
  }

  /**
   * Cancels a scheduled auto-expiry job (e.g. when seat is booked or released manually).
   */
  async cancelExpiry(seatId: string): Promise<boolean> {
    const jobId = `hold-expiry-${seatId}`;
    return this.queue.removeJob(jobId);
  }

  /**
   * Handler executed when delayed job fires.
   */
  private async handleExpiryJob(job: GenericJob<SeatHoldExpiryJobData>): Promise<void> {
    this.metrics.jobsProcessed++;
    const { seatId, userId, flightId } = job.data;

    try {
      const seat = await this.inventoryService.getSeatById(seatId);

      // 1. If seat not found or already available, no-op
      if (!seat || seat.status === 'AVAILABLE') {
        this.metrics.skippedCount++;
        logger.debug('Seat is already available, skipping auto-release', { seatId });
        return;
      }

      // 2. If seat was booked before expiry, no-op
      if (seat.status === 'BOOKED') {
        this.metrics.skippedCount++;
        logger.debug('Seat was confirmed and booked, skipping auto-release', { seatId });
        return;
      }

      // 3. If seat is still HELD by this user, auto-release back to AVAILABLE
      if (seat.status === 'HELD') {
        if (seat.heldByUserId === userId) {
          await this.inventoryService.releaseSeat(seatId, userId, 'TIMEOUT');
          this.metrics.autoReleasedCount++;

          logger.info('BullMQ delayed job: Seat hold expired, auto-released to AVAILABLE', {
            seatId,
            userId,
            flightId,
          });

          // Dispatch SEAT_RELEASED event
          if (this.eventDispatcher) {
            const event = createEvent(
              KAFKA_TOPICS.SEAT_RELEASED,
              'SeatReleased',
              'worker-service',
              {
                flightId,
                seatId,
                seatNumber: seat.seatNumber,
                reason: 'TIMEOUT',
              }
            );
            await this.eventDispatcher(event).catch((err) =>
              logger.error('Failed to dispatch SEAT_RELEASED event', err)
            );
          }
        } else {
          this.metrics.skippedCount++;
          logger.debug('Seat is held by another user, skipping auto-release', { seatId, currentHeldBy: seat.heldByUserId });
        }
      }
    } catch (err) {
      this.metrics.errorsCount++;
      logger.error('Error during seat hold auto-expiry job execution', err, { seatId, userId });
      throw err;
    }
  }
}
