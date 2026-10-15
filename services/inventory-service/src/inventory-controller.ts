import { Request, Response } from 'express';
import { InventoryService, ConcurrencyError } from './inventory-service';
import { KAFKA_TOPICS, createEvent } from '@airline/events';
import { createLogger } from '@airline/logger';

const logger = createLogger('inventory-controller');

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0];
  return param || '';
}

export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  /**
   * GET /api/inventory/flights/:flightId/seats
   */
  getSeatsByFlight = async (req: Request, res: Response): Promise<void> => {
    try {
      const flightId = getParam(req.params.flightId);
      if (!flightId) {
        res.status(400).json({ error: 'Bad Request', message: 'flightId parameter is required' });
        return;
      }

      const seats = await this.inventoryService.getSeatsByFlight(flightId);
      res.status(200).json({
        flightId,
        count: seats.length,
        data: seats,
      });
    } catch (err) {
      logger.error('Error fetching seats for flight', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  /**
   * GET /api/inventory/seats/:seatId
   */
  getSeatById = async (req: Request, res: Response): Promise<void> => {
    try {
      const seatId = getParam(req.params.seatId);
      const seat = await this.inventoryService.getSeatById(seatId);

      if (!seat) {
        res.status(404).json({ error: 'Not Found', message: `Seat ${seatId} not found` });
        return;
      }

      res.status(200).json({ data: seat });
    } catch (err) {
      logger.error('Error fetching seat', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  /**
   * POST /api/inventory/seats/:seatId/hold
   */
  holdSeat = async (req: Request, res: Response): Promise<void> => {
    try {
      const seatId = getParam(req.params.seatId);
      const userId = (req as any).user?.userId || req.body.userId;
      const holdDurationSeconds = req.body.holdDurationSeconds;

      if (!userId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'userId is required (in body or via Authorization token)',
        });
        return;
      }

      const result = await this.inventoryService.holdSeat(seatId, userId, holdDurationSeconds);

      // Event notification
      const event = createEvent(
        KAFKA_TOPICS.SEAT_HELD,
        'SeatHeld',
        'inventory-service',
        {
          flightId: result.seat.flightId,
          seatId: result.seat.id,
          seatNumber: result.seat.seatNumber,
          userId,
          heldUntil: result.heldUntil.toISOString(),
          price: result.seat.price,
        }
      );

      res.status(200).json({
        message: 'Seat held successfully',
        data: result,
        event: { eventId: event.eventId, topic: event.topic },
      });
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        if (err.code === 'LOCKED' || err.code === 'OCC_CONFLICT' || err.code === 'SEAT_NOT_AVAILABLE') {
          res.status(409).json({
            error: 'Conflict',
            code: err.code,
            message: err.message,
          });
          return;
        }
        if (err.code === 'UNAUTHORIZED') {
          res.status(403).json({ error: 'Forbidden', message: err.message });
          return;
        }
        if (err.code === 'NOT_FOUND') {
          res.status(404).json({ error: 'Not Found', message: err.message });
          return;
        }
      }

      logger.error('Unexpected error during seat hold', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  /**
   * POST /api/inventory/seats/:seatId/release
   */
  releaseSeat = async (req: Request, res: Response): Promise<void> => {
    try {
      const seatId = getParam(req.params.seatId);
      const userId = (req as any).user?.userId || req.body.userId;
      const reason = req.body.reason || 'USER_RELEASED';

      if (!userId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'userId is required',
        });
        return;
      }

      const result = await this.inventoryService.releaseSeat(seatId, userId, reason);

      const event = createEvent(
        KAFKA_TOPICS.SEAT_RELEASED,
        'SeatReleased',
        'inventory-service',
        {
          flightId: result.seat.flightId,
          seatId: result.seat.id,
          seatNumber: result.seat.seatNumber,
          reason: 'USER_CANCELLED',
        }
      );

      res.status(200).json({
        message: 'Seat hold released successfully',
        data: result,
        event: { eventId: event.eventId, topic: event.topic },
      });
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        if (err.code === 'UNAUTHORIZED') {
          res.status(403).json({ error: 'Forbidden', message: err.message });
          return;
        }
        if (err.code === 'LOCKED' || err.code === 'OCC_CONFLICT') {
          res.status(409).json({ error: 'Conflict', code: err.code, message: err.message });
          return;
        }
      }

      logger.error('Error releasing seat', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };

  /**
   * POST /api/inventory/seats/:seatId/confirm
   */
  confirmSeat = async (req: Request, res: Response): Promise<void> => {
    try {
      const seatId = getParam(req.params.seatId);
      const userId = (req as any).user?.userId || req.body.userId;
      const bookingId = req.body.bookingId;

      if (!userId || !bookingId) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Both userId and bookingId are required',
        });
        return;
      }

      const result = await this.inventoryService.confirmSeat(seatId, userId, bookingId);

      const event = createEvent(
        KAFKA_TOPICS.SEAT_BOOKED,
        'SeatBooked',
        'inventory-service',
        {
          flightId: result.seat.flightId,
          seatId: result.seat.id,
          seatNumber: result.seat.seatNumber,
          userId,
          bookingId,
        }
      );

      res.status(200).json({
        message: 'Seat booking confirmed',
        data: result,
        event: { eventId: event.eventId, topic: event.topic },
      });
    } catch (err) {
      if (err instanceof ConcurrencyError) {
        if (err.code === 'UNAUTHORIZED') {
          res.status(403).json({ error: 'Forbidden', message: err.message });
          return;
        }
        if (err.code === 'LOCKED' || err.code === 'OCC_CONFLICT' || err.code === 'SEAT_NOT_AVAILABLE') {
          res.status(409).json({ error: 'Conflict', code: err.code, message: err.message });
          return;
        }
      }

      logger.error('Error confirming seat', err);
      res.status(500).json({ error: 'Internal Server Error', message: (err as Error).message });
    }
  };
}
