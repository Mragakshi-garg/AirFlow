import { Booking, Passenger, Payment, PaymentMethod, OutboxEvent } from '@airline/types';
import { createLogger } from '@airline/logger';
import { InventoryService } from '@airline/inventory-service';
import { PaymentService } from '@airline/payment-service';
import { BookingRepository, BookingWithPassengers } from './booking-repository';

const logger = createLogger('booking-saga');

export interface InitiateBookingParams {
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

export type SagaState = 'STARTED' | 'PAYMENT_PENDING' | 'COMPLETED' | 'COMPENSATED' | 'FAILED';

export interface SagaResult {
  success: boolean;
  booking: BookingWithPassengers;
  payment?: Payment;
  pnr: string;
  sagaState: SagaState;
  errorMessage?: string;
  cached?: boolean;
}

export function generatePNR(): string {
  // 6-character alphanumeric excluding confusing characters (0, O, 1, I)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let pnr = '';
  for (let i = 0; i < 6; i++) {
    pnr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pnr;
}

export class BookingSagaOrchestrator {
  constructor(
    private repo: BookingRepository,
    private inventoryService: InventoryService,
    private paymentService: PaymentService
  ) {}

  /**
   * Execute full distributed Booking Saga with automatic compensation on failure.
   */
  async executeBookingSaga(params: InitiateBookingParams): Promise<SagaResult> {
    const {
      flightId,
      seatId,
      userId,
      passengers,
      totalAmount,
      currency = 'USD',
      paymentMethod = 'CREDIT_CARD',
      simulatePaymentFailure = false,
      failureReason = 'CARD_DECLINED',
      idempotencyKey,
    } = params;

    logger.info('Initiating Booking Saga', { flightId, seatId, userId, totalAmount });

    // ─────────────────────────────────────────────────────────────
    // Step 1: Prepare Booking and Atomic Outbox Event
    // ─────────────────────────────────────────────────────────────
    const bookingId = `bk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const pnr = generatePNR();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute booking window

    const initialBooking: Booking = {
      id: bookingId,
      userId,
      flightId,
      seatId,
      totalAmount,
      currency,
      status: 'PENDING',
      bookingReference: pnr,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const outboxEventId = `outbox-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const bookingCreatedEvent: OutboxEvent = {
      id: outboxEventId,
      aggregateType: 'BOOKING',
      aggregateId: bookingId,
      eventType: 'BookingCreated',
      payload: {
        bookingId,
        pnr,
        flightId,
        seatId,
        userId,
        totalAmount,
        currency,
        createdAt: new Date().toISOString(),
      },
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    };

    // Save booking + passengers + outbox event atomically
    const { booking: createdBooking, passengers: savedPassengers } =
      await this.repo.createBookingWithOutbox(initialBooking, passengers, bookingCreatedEvent);

    let currentBooking: BookingWithPassengers = {
      ...createdBooking,
      passengers: savedPassengers,
    };

    // ─────────────────────────────────────────────────────────────
    // Step 2: Payment Processing Phase
    // ─────────────────────────────────────────────────────────────
    logger.info('Saga Step 2: Requesting payment processing', { bookingId, amount: totalAmount });

    const paymentResult = await this.paymentService.processPayment({
      bookingId,
      userId,
      amount: totalAmount,
      currency,
      method: paymentMethod,
      simulateFailure: simulatePaymentFailure,
      failureReason,
      idempotencyKey: idempotencyKey ? `pay-${idempotencyKey}` : undefined,
    });

    // ─────────────────────────────────────────────────────────────
    // Step 3a: Payment Succeeded -> Complete Saga (Confirm Seat & Booking)
    // ─────────────────────────────────────────────────────────────
    if (paymentResult.success) {
      logger.info('Saga Step 3: Payment succeeded. Confirming seat hold in inventory', {
        bookingId,
        seatId,
      });

      try {
        // Confirm seat hold in Inventory Service
        await this.inventoryService.confirmSeat(seatId, userId, bookingId);

        // Update booking status to CONFIRMED
        const confirmedBooking = await this.repo.updateBookingStatus(bookingId, 'CONFIRMED');
        currentBooking = {
          ...confirmedBooking!,
          passengers: savedPassengers,
        };

        // Record BookingConfirmed outbox event
        await this.repo.saveOutboxEvent({
          id: `outbox-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          aggregateType: 'BOOKING',
          aggregateId: bookingId,
          eventType: 'BookingConfirmed',
          payload: {
            bookingId,
            pnr,
            flightId,
            seatId,
            userId,
            paymentId: paymentResult.payment.id,
            transactionId: paymentResult.transactionId,
            confirmedAt: new Date().toISOString(),
          },
          status: 'PENDING',
          retryCount: 0,
          createdAt: new Date(),
        });

        logger.info('Saga Step 4: Booking confirmed successfully', { bookingId, pnr });

        return {
          success: true,
          booking: currentBooking,
          payment: paymentResult.payment,
          pnr,
          sagaState: 'COMPLETED',
        };
      } catch (confirmError) {
        // Compensating Transaction: Seat confirmation failed after payment
        logger.error('Seat confirmation failed. Executing compensating transaction (Refund)', confirmError);

        // 1. Compensate Payment (Refund)
        await this.paymentService.refundPayment(paymentResult.payment.id, 'SEAT_CONFIRM_FAILED').catch((err) => {
          logger.error('Payment refund failed during saga compensation', err);
        });

        // 2. Compensate Inventory (Release seat hold)
        await this.inventoryService.releaseSeat(seatId, userId, 'SAGA_ROLLBACK').catch((err) => {
          logger.error('Seat release failed during saga compensation', err);
        });

        // 3. Mark booking FAILED
        const failedBooking = await this.repo.updateBookingStatus(bookingId, 'FAILED');
        currentBooking = {
          ...failedBooking!,
          passengers: savedPassengers,
        };

        return {
          success: false,
          booking: currentBooking,
          pnr,
          sagaState: 'COMPENSATED',
          errorMessage: `Seat confirmation failed: ${(confirmError as Error).message}. Payment was refunded.`,
        };
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Step 3b: Payment Failed -> Execute Compensating Transaction
    // ─────────────────────────────────────────────────────────────
    logger.warn('Saga Step 3: Payment rejected. Triggering compensating transactions', {
      bookingId,
      reason: paymentResult.errorMessage,
    });

    // 1. Compensating transaction: Release seat hold in Inventory Service
    try {
      await this.inventoryService.releaseSeat(seatId, userId, 'PAYMENT_FAILED');
      logger.info('Compensating step succeeded: Held seat released back to inventory', { seatId });
    } catch (releaseErr) {
      logger.error('Compensating step failed: Could not release seat hold', releaseErr, { seatId });
    }

    // 2. Update booking status to FAILED
    const failedBooking = await this.repo.updateBookingStatus(bookingId, 'FAILED');
    currentBooking = {
      ...failedBooking!,
      passengers: savedPassengers,
    };

    // 3. Record BookingCancelled outbox event
    await this.repo.saveOutboxEvent({
      id: `outbox-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      aggregateType: 'BOOKING',
      aggregateId: bookingId,
      eventType: 'BookingCancelled',
      payload: {
        bookingId,
        pnr,
        reason: paymentResult.errorMessage || 'PAYMENT_FAILED',
        cancelledAt: new Date().toISOString(),
      },
      status: 'PENDING',
      retryCount: 0,
      createdAt: new Date(),
    });

    return {
      success: false,
      booking: currentBooking,
      payment: paymentResult.payment,
      pnr,
      sagaState: 'COMPENSATED',
      errorMessage: paymentResult.errorMessage || 'Payment failed',
    };
  }
}
