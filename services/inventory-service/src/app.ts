import express, { Express, Request, Response, NextFunction } from 'express';
import { TokenService } from '@airline/auth-service';
import { InventoryRepository, InMemoryInventoryRepository } from './inventory-repository';
import { RedlockManager } from './redlock';
import { InventoryService } from './inventory-service';
import { InventoryController } from './inventory-controller';

export interface CreateInventoryAppOptions {
  repo?: InventoryRepository;
  redlock?: RedlockManager;
  tokenService?: TokenService;
  inventoryService?: InventoryService;
}

export function createInventoryApp(options?: CreateInventoryAppOptions): {
  app: Express;
  repo: InventoryRepository;
  redlock: RedlockManager;
  inventoryService: InventoryService;
  controller: InventoryController;
} {
  const app = express();
  app.use(express.json());

  const repo = options?.repo || new InMemoryInventoryRepository();
  const redlock = options?.redlock || new RedlockManager();
  const inventoryService =
    options?.inventoryService || new InventoryService(repo, redlock);
  const controller = new InventoryController(inventoryService);
  const tokenService = options?.tokenService;

  // Optional JWT extractor: if Authorization header is present, parse it
  const optionalAuthMiddleware = async (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ') && tokenService) {
      const token = authHeader.substring(7);
      const payload = await tokenService.verifyToken(token);
      if (payload) {
        (req as any).user = payload;
      }
    }
    next();
  };

  app.use(optionalAuthMiddleware);

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'inventory-service' });
  });

  // Inventory Routes
  app.get('/api/inventory/flights/:flightId/seats', controller.getSeatsByFlight);
  app.get('/api/inventory/seats/:seatId', controller.getSeatById);
  app.post('/api/inventory/seats/:seatId/hold', controller.holdSeat);
  app.post('/api/inventory/seats/:seatId/release', controller.releaseSeat);
  app.post('/api/inventory/seats/:seatId/confirm', controller.confirmSeat);

  return { app, repo, redlock, inventoryService, controller };
}
