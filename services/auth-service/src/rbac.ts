import { Request, Response, NextFunction } from 'express';
import { AuthTokenPayload, UserRole } from '@airline/types';
import { TokenService } from './token-service';

// Extend Express Request interface to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
      token?: string;
    }
  }
}

export function createAuthMiddleware(tokenService: TokenService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or malformed Authorization header with Bearer token',
      });
      return;
    }

    const token = authHeader.substring(7);
    const userPayload = await tokenService.verifyToken(token);

    if (!userPayload) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or revoked token',
      });
      return;
    }

    req.user = userPayload;
    req.token = token;
    next();
  };
}

/**
 * Role-Based Access Control (RBAC) guard.
 * Ensures the authenticated user has at least one of the required roles.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required before checking roles',
      });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Role '${req.user.role}' is not authorized. Required: [${allowedRoles.join(', ')}]`,
      });
      return;
    }

    next();
  };
}
