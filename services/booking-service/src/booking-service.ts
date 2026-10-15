import { Passenger, PaymentMethod } from '@airline/types';
import { createLogger } from '@airline/logger';
import { InventoryService } from '@airline/inventory-service';
import { PaymentService } from '@airline/payment-service';
import { BookingRepository, BookingWithPassengers, InMemoryBookingRepository } from './booking-repository';
import { BookingSagaOrchestrator, SagaResult } from './saga-orchestrator';

const logger = createLogger('booking-service');

export interface CreateBookingRequest {
  flightId: string;
  seatId: string;
  userId: string;
  passengers: Passenger[];
  totalAmount: number;
  currency?: string;
  paymentMethod?: PaymentMethod;
  simulatePaymentFailure?: boolean;
  failureReason?: string;
  idempotencyKey?: string;
}

export class BookingService {
  private sagaOrchestrator: BookingSagaOrchestrator;

  constructor(
    private repo: BookingRepository = new InMemoryBookingRepository(),
    private inventoryService: InventoryService,
    private paymentService: PaymentService
  ) {
    this.sagaOrchestrator = new BookingSagaOrchestrator(this.repo, this.inventoryService, this.paymentService);
  }

  /**
   * Create a booking through the Saga Orchestrator with strict Idempotency Key protection.
   */
  async createBooking(request: CreateBookingRequest): Promise<SagaResult> {
    const { idempotencyKey } = request;

    // 1. Idempotency Check: return exact cached result if key was previously processed
    if (idempotencyKey) {
      const cached = await this.repo.getIdempotencyRecord(idempotencyKey);
      if (cached) {
        logger.info('Duplicate idempotency key detected, returning cached booking result', {
          idempotencyKey,
        });
        return {
          ...cached.responsePayload,
          cached: true,
        } as SagaResult;
      }
    }

    // 2. Execute Saga
    const sagaResult = await this.sagaOrchestrator.executeBookingSaga(request);

    // 3. Cache idempotent response
    if (idempotencyKey) {
      await this.repo.saveIdempotencyRecord({
        id: `idem-${Date.now()}`,
        idempotencyKey,
        handlerName: 'createBooking',
        responsePayload: sagaResult,
        statusCode: sagaResult.success ? 201 : 402,
        createdAt: new Date(),
      });
    }

    return sagaResult;
  }

  /**
   * Cancel an existing booking and release the seat back to inventory.
   */
  async cancelBooking(bookingId: string, userId: string, reason: string = 'USER_REQUESTED'): Promise<BookingWithPassengers> {
    const booking = await this.repo.getBookingById(bookingId);
    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    if (booking.userId !== userId) {
      throw new Error('Unauthorized to cancel this booking');
    }

    if (booking.status === 'CANCELLED') {
      return booking;
    }

    if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING') {
      throw new Error(`Cannot cancel booking in status ${booking.status}`);
    }

    // Release or cancel seat in inventory
    if (booking.status === 'CONFIRMED') {
      await this.inventoryService.cancelSeatBooking(booking.seatId, userId, reason).catch((err) => {
        logger.warn('Failed to cancel seat booking during cancellation', { seatId: booking.seatId, error: err.message });
      });
    } else {
      await this.inventoryService.releaseSeat(booking.seatId, userId, reason).catch((err) => {
        logger.warn('Failed to release seat during booking cancellation', { seatId: booking.seatId, error: err.message });
      });
    }

    const updated = await this.repo.updateBookingStatus(bookingId, 'CANCELLED');

    // Record outbox event
    await this.repo.saveOutboxEvent({
      id: `outbox-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      aggregateType: 'BOOKING',
      aggregateId: bookingId,
      eventType: 'BookingCancelled',
      payload: {
        bookingId,
        pnr: booking.bookingReference,
        userId,
        reason,
        cancelledAt: new Date().toISOString(),
      },
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    });

    return {
      ...updated!,
      passengers: booking.passengers,
    };
  }

  async getBookingById(id: string): Promise<BookingWithPassengers | null> {
    return this.repo.getBookingById(id);
  }

  async getBookingByPnr(pnr: string): Promise<BookingWithPassengers | null> {
    return this.repo.getBookingByReference(pnr);
  }

  async getUserBookings(userId: string): Promise<BookingWithPassengers[]> {
    return this.repo.getBookingsByUserId(userId);
  }
}
