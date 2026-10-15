import { InventoryService, InventoryRepository } from '@airline/inventory-service';
import { BookingRepository } from '@airline/booking-service';
import { EventEnvelope } from '@airline/events';
import { createLogger } from '@airline/logger';
import { IJobQueue, InMemoryJobQueue, BullMQAdapter } from './job-queue';
import { SeatHoldExpiryWorker, SeatHoldExpiryJobData } from './seat-hold-worker';
import { PeriodicSweeper, SweeperResult } from './periodic-sweeper';

const logger = createLogger('worker-manager');

export interface WorkerManagerOptions {
  queue?: IJobQueue<SeatHoldExpiryJobData>;
  redisUrl?: string;
  inventoryService: InventoryService;
  inventoryRepo: InventoryRepository;
  bookingRepo: BookingRepository;
  eventDispatcher?: (event: EventEnvelope) => Promise<void>;
  sweeperIntervalMs?: number;
}

export class WorkerManager {
  public seatHoldWorker: SeatHoldExpiryWorker;
  public periodicSweeper: PeriodicSweeper;
  private queue: IJobQueue<SeatHoldExpiryJobData>;
  private isRunning: boolean = false;

  constructor(private options: WorkerManagerOptions) {
    if (options.queue) {
      this.queue = options.queue;
    } else if (options.redisUrl || process.env.REDIS_URL) {
      try {
        const url = new URL(options.redisUrl || process.env.REDIS_URL!);
        this.queue = new BullMQAdapter<SeatHoldExpiryJobData>('seat-hold-expiry', {
          host: url.hostname || 'localhost',
          port: parseInt(url.port || '6379', 10),
        });
      } catch {
        logger.warn('Failed to parse Redis URL, falling back to InMemoryJobQueue');
        this.queue = new InMemoryJobQueue<SeatHoldExpiryJobData>('seat-hold-expiry');
      }
    } else {
      this.queue = new InMemoryJobQueue<SeatHoldExpiryJobData>('seat-hold-expiry');
    }

    this.seatHoldWorker = new SeatHoldExpiryWorker(
      this.queue,
      options.inventoryService,
      options.eventDispatcher
    );

    this.periodicSweeper = new PeriodicSweeper(
      options.inventoryRepo,
      options.bookingRepo,
      options.eventDispatcher
    );
  }

  /**
   * Schedule a delayed job to automatically expire and release a held seat.
   */
  async scheduleSeatHoldExpiry(
    seatId: string,
    userId: string,
    flightId: string,
    delayMs?: number
  ): Promise<void> {
    await this.seatHoldWorker.scheduleExpiry(seatId, userId, flightId, delayMs);
  }

  /**
   * Cancel an existing delayed auto-expiry job when seat is booked or released manually.
   */
  async cancelSeatHoldExpiry(seatId: string): Promise<boolean> {
    return this.seatHoldWorker.cancelExpiry(seatId);
  }

  /**
   * Execute an immediate sweep of both seat holds and pending bookings.
   */
  async runSweepNow(): Promise<SweeperResult> {
    return this.periodicSweeper.runSweepNow();
  }

  /**
   * Start worker background loops.
   */
  start(): void {
    if (this.isRunning) return;
    this.periodicSweeper.start(this.options.sweeperIntervalMs || 30000);
    this.isRunning = true;
    logger.info('Worker Manager started successfully');
  }

  /**
   * Gracefully stop all background jobs and close queues.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.periodicSweeper.stop();
    await this.queue.close();
    this.isRunning = false;
    logger.info('Worker Manager stopped gracefully');
  }

  /**
   * Aggregated health check and metrics report.
   */
  async getMetrics(): Promise<{
    status: 'healthy';
    seatHoldWorker: { jobsProcessed: number; autoReleasedCount: number; skippedCount: number; errorsCount: number };
    periodicSweeper: { totalSweepsRun: number; totalExpiredSeatsCleaned: number; totalExpiredBookingsCleaned: number };
    queueCounts: { delayed: number; active: number; completed: number; failed: number };
  }> {
    const queueCounts = await this.queue.getCounts();
    return {
      status: 'healthy',
      seatHoldWorker: this.seatHoldWorker.metrics,
      periodicSweeper: this.periodicSweeper.metrics,
      queueCounts,
    };
  }
}
