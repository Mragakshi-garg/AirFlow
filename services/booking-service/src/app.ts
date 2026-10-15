import express, { Express } from 'express';
import { InventoryService, InMemoryInventoryRepository, RedlockManager } from '@airline/inventory-service';
import { PaymentService, InMemoryPaymentRepository } from '@airline/payment-service';
import { BookingRepository, InMemoryBookingRepository } from './booking-repository';
import { BookingService } from './booking-service';
import { OutboxRelay } from './outbox-relay';
import { BookingController } from './booking-controller';

export interface CreateBookingAppOptions {
  repo?: BookingRepository;
  inventoryService?: InventoryService;
  paymentService?: PaymentService;
  outboxRelay?: OutboxRelay;
  bookingService?: BookingService;
}

export function createBookingApp(options?: CreateBookingAppOptions): {
  app: Express;
  repo: BookingRepository;
  inventoryService: InventoryService;
  paymentService: PaymentService;
  bookingService: BookingService;
  outboxRelay?: OutboxRelay;
  controller: BookingController;
} {
  const app = express();
  app.use(express.json());

  const repo = options?.repo || new InMemoryBookingRepository();
  const inventoryService =
    options?.inventoryService ||
    new InventoryService(new InMemoryInventoryRepository(), new RedlockManager());
  const paymentService = options?.paymentService || new PaymentService(new InMemoryPaymentRepository());

  const bookingService =
    options?.bookingService || new BookingService(repo, inventoryService, paymentService);
  const outboxRelay = options?.outboxRelay;
  const controller = new BookingController(bookingService, outboxRelay);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'booking-service' });
  });

  // Booking Routes
  app.post('/api/bookings', controller.createBooking);
  app.get('/api/bookings/:id', controller.getBookingById);
  app.get('/api/bookings/pnr/:pnr', controller.getBookingByPnr);
  app.get('/api/bookings/user/:userId', controller.getUserBookings);
  app.post('/api/bookings/:id/cancel', controller.cancelBooking);
  app.post('/api/bookings/outbox/relay', controller.relayOutbox);

  return { app, repo, inventoryService, paymentService, bookingService, outboxRelay, controller };
}
