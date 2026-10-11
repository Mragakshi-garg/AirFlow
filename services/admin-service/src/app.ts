import express, { Express } from 'express';
import { TokenService, createAuthMiddleware, requireRole } from '@airline/auth-service';
import { AdminController, AdminRepository, InMemoryAdminRepository } from './admin-controller';

export function createAdminApp(options?: {
  tokenService?: TokenService;
  adminRepo?: AdminRepository;
}): { app: Express; adminRepo: AdminRepository; tokenService: TokenService } {
  const app = express();
  app.use(express.json());

  const tokenService = options?.tokenService || new TokenService();
  const adminRepo = options?.adminRepo || new InMemoryAdminRepository();
  const controller = new AdminController(adminRepo);

  const authMiddleware = createAuthMiddleware(tokenService);
  const adminGuard = requireRole('ADMIN', 'AIRLINE_ADMIN');

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'admin-service' });
  });

  // Protected Admin Routes: require authentication + ADMIN or AIRLINE_ADMIN role
  // 1. Airlines
  app.get('/api/admin/airlines', authMiddleware, adminGuard, controller.getAirlines);
  app.post('/api/admin/airlines', authMiddleware, adminGuard, controller.createAirline);
  app.put('/api/admin/airlines/:id', authMiddleware, adminGuard, controller.updateAirline);
  app.delete('/api/admin/airlines/:id', authMiddleware, adminGuard, controller.deleteAirline);

  // 2. Flights
  app.get('/api/admin/flights', authMiddleware, adminGuard, controller.getFlights);
  app.post('/api/admin/flights', authMiddleware, adminGuard, controller.createFlight);
  app.put('/api/admin/flights/:id/status', authMiddleware, adminGuard, controller.updateFlightStatus);

  // 3. Seat Inventory
  app.get('/api/admin/flights/:id/seats', authMiddleware, adminGuard, controller.getFlightSeats);
  app.post('/api/admin/flights/:id/seats/generate', authMiddleware, adminGuard, controller.generateFlightSeats);

  return { app, adminRepo, tokenService };
}
