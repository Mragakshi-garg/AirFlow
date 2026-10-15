import { Request, Response } from 'express';
import { BookingService } from './booking-service';
import { OutboxRelay } from './outbox-relay';
import { createLogger } from '@airline/logger';

const logger = createLogger('booking-controller');

export class BookingController {
  constructor(
    private bookingService: BookingService,
    private outboxRelay?: OutboxRelay
  ) {}

  createBooking = async (req: Request, res: Response): Promise<void> => {
    try {
      const idempotencyKey = (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) as string | undefined;
      const {
        flightId,
        seatId,
        userId,
        passengers,
        totalAmount,
        currency,
        paymentMethod,
        simulatePaymentFailure,
        failureReason,
      } = req.body;

      if (!flightId || !seatId || !userId || !totalAmount) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'flightId, seatId, userId, and totalAmount are required',
        });
        return;
      }

      const result = await this.bookingService.createBooking({
        flightId,
        seatId,
        userId,
        passengers: passengers || [],
        totalAmount,
        currency,
        paymentMethod,
        simulatePaymentFailure,
        failureReason,
        idempotencyKey,
      });

      if (!result.success) {
        res.status(402).json({
          success: false,
          error: 'Payment / Booking Failed',
          message: result.errorMessage,
          sagaState: result.sagaState,
          booking: result.booking,
          payment: result.payment,
        });
        return;
      }

      res.status(201).json({
        success: true,
        cached: result.cached || false,
        pnr: result.pnr,
        sagaState: result.sagaState,
        booking: result.booking,
        payment: result.payment,
      });
    } catch (err) {
      logger.error('Error creating booking', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  getBookingById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const booking = await this.bookingService.getBookingById(id);

      if (!booking) {
        res.status(404).json({ error: 'Not Found', message: `Booking ${id} not found` });
        return;
      }

      res.status(200).json({ success: true, booking });
    } catch (err) {
      logger.error('Error fetching booking', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  getBookingByPnr = async (req: Request, res: Response): Promise<void> => {
    try {
      const pnr = Array.isArray(req.params.pnr) ? req.params.pnr[0] : req.params.pnr;
      const booking = await this.bookingService.getBookingByPnr(pnr);

      if (!booking) {
        res.status(404).json({ error: 'Not Found', message: `Booking with PNR ${pnr} not found` });
        return;
      }

      res.status(200).json({ success: true, booking });
    } catch (err) {
      logger.error('Error fetching booking by PNR', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  getUserBookings = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
      const bookings = await this.bookingService.getUserBookings(userId);
      res.status(200).json({ success: true, count: bookings.length, bookings });
    } catch (err) {
      logger.error('Error fetching user bookings', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  cancelBooking = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const { userId, reason } = req.body;

      if (!userId) {
        res.status(400).json({ error: 'Bad Request', message: 'userId is required' });
        return;
      }

      const cancelled = await this.bookingService.cancelBooking(id, userId, reason);
      res.status(200).json({ success: true, message: 'Booking cancelled', booking: cancelled });
    } catch (err) {
      logger.error('Error cancelling booking', err);
      res.status(400).json({ error: 'Cancellation Failed', message: (err as Error).message });
    }
  };

  relayOutbox = async (_req: Request, res: Response): Promise<void> => {
    try {
      if (!this.outboxRelay) {
        res.status(503).json({ error: 'Service Unavailable', message: 'Outbox relay not configured' });
        return;
      }

      const published = await this.outboxRelay.relayBatch();
      res.status(200).json({
        success: true,
        publishedCount: published,
        metrics: this.outboxRelay.metrics,
      });
    } catch (err) {
      logger.error('Error triggering outbox relay sweep', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };
}
