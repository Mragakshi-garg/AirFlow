import { Request, Response } from 'express';
import { PaymentService } from './payment-service';
import { createLogger } from '@airline/logger';

const logger = createLogger('payment-controller');

export class PaymentController {
  constructor(private paymentService: PaymentService) {}

  processPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const idempotencyKey = (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) as string | undefined;
      const { bookingId, userId, amount, currency, method, simulateFailure, failureReason } = req.body;

      if (!bookingId || !userId || !amount) {
        res.status(400).json({ error: 'Bad Request', message: 'bookingId, userId, and amount are required' });
        return;
      }

      const result = await this.paymentService.processPayment({
        bookingId,
        userId,
        amount,
        currency,
        method,
        idempotencyKey,
        simulateFailure,
        failureReason,
      });

      if (!result.success) {
        res.status(402).json({
          success: false,
          error: 'Payment Required',
          message: result.errorMessage || 'Payment failed',
          payment: result.payment,
        });
        return;
      }

      res.status(200).json({
        success: true,
        cached: result.cached || false,
        payment: result.payment,
      });
    } catch (err) {
      logger.error('Error processing payment', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  getPaymentById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const payment = await this.paymentService.getPaymentById(id);

      if (!payment) {
        res.status(404).json({ error: 'Not Found', message: `Payment ${id} not found` });
        return;
      }

      res.status(200).json({ success: true, payment });
    } catch (err) {
      logger.error('Error fetching payment', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  getPaymentsByBooking = async (req: Request, res: Response): Promise<void> => {
    try {
      const bookingId = Array.isArray(req.params.bookingId) ? req.params.bookingId[0] : req.params.bookingId;
      const payments = await this.paymentService.getPaymentsByBookingId(bookingId);
      res.status(200).json({ success: true, count: payments.length, payments });
    } catch (err) {
      logger.error('Error fetching payments for booking', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  refundPayment = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { reason } = req.body;
      const result = await this.paymentService.refundPayment(id, reason);
      res.status(200).json({ success: true, message: 'Payment refunded', payment: result.payment });
    } catch (err) {
      logger.error('Error refunding payment', err);
      res.status(400).json({ error: 'Refund Failed', message: (err as Error).message });
    }
  };
}
