import { Payment, PaymentMethod, PaymentStatus } from '@airline/types';
import { createEvent, KAFKA_TOPICS, EventEnvelope } from '@airline/events';
import { createLogger } from '@airline/logger';
import { PaymentRepository, InMemoryPaymentRepository } from './payment-repository';

const logger = createLogger('payment-service');

export interface ProcessPaymentParams {
  bookingId: string;
  userId: string;
  amount: number;
  currency?: string;
  method?: PaymentMethod;
  idempotencyKey?: string;
  simulateFailure?: boolean;
  failureReason?: string;
}

export interface PaymentResult {
  success: boolean;
  payment: Payment;
  transactionId?: string;
  errorMessage?: string;
  cached?: boolean;
}

export class PaymentService {
  constructor(
    private repo: PaymentRepository = new InMemoryPaymentRepository(),
    private eventDispatcher?: (event: EventEnvelope) => Promise<void>
  ) {}

  /**
   * Process payment with idempotency protection and configurable mock failure simulation.
   */
  async processPayment(params: ProcessPaymentParams): Promise<PaymentResult> {
    const {
      bookingId,
      userId,
      amount,
      currency = 'USD',
      method = 'CREDIT_CARD',
      idempotencyKey,
      simulateFailure = false,
      failureReason = 'CARD_DECLINED',
    } = params;

    // 1. Idempotency Check
    if (idempotencyKey) {
      const cached = await this.repo.getIdempotencyRecord(idempotencyKey);
      if (cached) {
        logger.info('Idempotent payment request detected, returning cached result', { idempotencyKey });
        return {
          ...cached.responsePayload,
          cached: true,
        } as PaymentResult;
      }
    }

    const paymentId = `pay-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const isSuccess = !simulateFailure;
    const transactionId = isSuccess ? `txn-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}` : undefined;
    const status: PaymentStatus = isSuccess ? 'SUCCESS' : 'FAILED';
    const errorMessage = !isSuccess ? failureReason : undefined;

    const payment: Payment = {
      id: paymentId,
      bookingId,
      userId,
      amount,
      currency,
      method,
      status,
      transactionId,
      errorMessage,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const savedPayment = await this.repo.createPayment(payment);

    // 2. Dispatch events
    if (this.eventDispatcher) {
      if (isSuccess) {
        const event = createEvent(
          KAFKA_TOPICS.PAYMENT_SUCCESS,
          'PaymentSuccess',
          'payment-service',
          {
            payment: savedPayment,
            bookingId,
            amount,
            transactionId: transactionId!,
          }
        );
        await this.eventDispatcher(event).catch((err) =>
          logger.error('Failed to dispatch PAYMENT_SUCCESS event', err)
        );
      } else {
        const event = createEvent(
          KAFKA_TOPICS.PAYMENT_FAILED,
          'PaymentFailed',
          'payment-service',
          {
            paymentId: savedPayment.id,
            bookingId,
            userId,
            reason: failureReason,
          }
        );
        await this.eventDispatcher(event).catch((err) =>
          logger.error('Failed to dispatch PAYMENT_FAILED event', err)
        );
      }
    }

    const result: PaymentResult = {
      success: isSuccess,
      payment: savedPayment,
      transactionId,
      errorMessage,
      cached: false,
    };

    // 3. Cache Idempotency
    if (idempotencyKey) {
      await this.repo.saveIdempotencyRecord({
        id: `idem-${Date.now()}`,
        idempotencyKey,
        handlerName: 'processPayment',
        responsePayload: result,
        statusCode: isSuccess ? 200 : 402,
        createdAt: new Date(),
      });
    }

    return result;
  }

  async getPaymentById(id: string): Promise<Payment | null> {
    return this.repo.getPaymentById(id);
  }

  async getPaymentsByBookingId(bookingId: string): Promise<Payment[]> {
    return this.repo.getPaymentsByBookingId(bookingId);
  }

  async refundPayment(paymentId: string, reason: string = 'SAGA_COMPENSATION'): Promise<PaymentResult> {
    const payment = await this.repo.getPaymentById(paymentId);
    if (!payment) {
      throw new Error(`Payment ${paymentId} not found`);
    }

    if (payment.status !== 'SUCCESS') {
      throw new Error(`Cannot refund payment in status ${payment.status}`);
    }

    const updated = await this.repo.updatePaymentStatus(
      paymentId,
      'REFUNDED',
      payment.transactionId,
      `Refunded: ${reason}`
    );

    logger.info('Payment refunded', { paymentId, reason });

    return {
      success: true,
      payment: updated!,
      transactionId: payment.transactionId,
    };
  }
}
