import express, { Express } from 'express';
import { PaymentRepository, InMemoryPaymentRepository } from './payment-repository';
import { PaymentService } from './payment-service';
import { PaymentController } from './payment-controller';

export interface CreatePaymentAppOptions {
  repo?: PaymentRepository;
  paymentService?: PaymentService;
}

export function createPaymentApp(options?: CreatePaymentAppOptions): {
  app: Express;
  repo: PaymentRepository;
  paymentService: PaymentService;
  controller: PaymentController;
} {
  const app = express();
  app.use(express.json());

  const repo = options?.repo || new InMemoryPaymentRepository();
  const paymentService = options?.paymentService || new PaymentService(repo);
  const controller = new PaymentController(paymentService);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'payment-service' });
  });

  // Payment Routes
  app.post('/api/payments/process', controller.processPayment);
  app.get('/api/payments/:id', controller.getPaymentById);
  app.get('/api/payments/booking/:bookingId', controller.getPaymentsByBooking);
  app.post('/api/payments/:id/refund', controller.refundPayment);

  return { app, repo, paymentService, controller };
}
