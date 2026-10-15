import { OutboxEvent } from '@airline/types';
import { createLogger } from '@airline/logger';
import { BookingRepository } from './booking-repository';

const logger = createLogger('outbox-relay');

export type EventPublisher = (event: OutboxEvent) => Promise<void>;

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  public metrics = {
    publishedCount: 0,
    failedCount: 0,
    totalProcessed: 0,
  };

  constructor(
    private repo: BookingRepository,
    private publisher: EventPublisher,
    private intervalMs: number = 5000
  ) {}

  /**
   * Run a single sweep of pending outbox events and relay to message broker.
   */
  async relayBatch(limit: number = 50): Promise<number> {
    const pendingEvents = await this.repo.getPendingOutboxEvents(limit);
    if (pendingEvents.length === 0) {
      return 0;
    }

    let publishedInBatch = 0;

    for (const event of pendingEvents) {
      try {
        await this.publisher(event);
        await this.repo.markOutboxEventPublished(event.id);
        this.metrics.publishedCount++;
        this.metrics.totalProcessed++;
        publishedInBatch++;
        logger.debug('Outbox event relayed successfully', {
          id: event.id,
          aggregateType: event.aggregateType,
          eventType: event.eventType,
        });
      } catch (err) {
        logger.error('Failed to relay outbox event', err, {
          id: event.id,
          eventType: event.eventType,
        });
        await this.repo.markOutboxEventFailed(event.id, (err as Error).message);
        this.metrics.failedCount++;
        this.metrics.totalProcessed++;
      }
    }

    return publishedInBatch;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.relayBatch().catch((err) => {
        logger.error('Error during scheduled outbox sweep', err);
      });
    }, this.intervalMs);
    logger.info('Outbox Relay background worker started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Outbox Relay stopped');
    }
  }
}
