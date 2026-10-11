import express, { Express } from 'express';
import { TokenService } from './token-service';
import { AuthController, AuthRepository, InMemoryUserRepository } from './auth-controller';
import { createAuthMiddleware } from './rbac';
import { SEED_USERS } from '@airline/db';
import { User } from '@airline/types';

export function createAuthApp(options?: {
  tokenService?: TokenService;
  userRepo?: AuthRepository;
}): { app: Express; tokenService: TokenService; userRepo: AuthRepository } {
  const app = express();
  app.use(express.json());

  const tokenService = options?.tokenService || new TokenService();
  const now = new Date();
  const initialUsers: User[] = SEED_USERS.map((u) => ({
    ...u,
    createdAt: now,
    updatedAt: now,
  }));
  const userRepo = options?.userRepo || new InMemoryUserRepository(initialUsers);

  const controller = new AuthController(tokenService, userRepo);
  const authMiddleware = createAuthMiddleware(tokenService);

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'auth-service' });
  });

  // Auth routes
  app.post('/api/auth/register', controller.register);
  app.post('/api/auth/login', controller.login);
  app.post('/api/auth/logout', authMiddleware, controller.logout);
  app.get('/api/auth/me', authMiddleware, controller.getMe);

  return { app, tokenService, userRepo };
}
