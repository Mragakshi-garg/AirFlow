import jwt, { SignOptions } from 'jsonwebtoken';
import Redis from 'ioredis';
import { AuthTokenPayload, UserRole } from '@airline/types';
import { createLogger } from '@airline/logger';

const logger = createLogger('auth-token-service');

export interface TokenServiceConfig {
  jwtSecret?: string;
  expiresIn?: string;
  redisUrl?: string;
}

export class TokenService {
  private jwtSecret: string;
  private expiresIn: string;
  private redis: Redis | null = null;
  // Fallback in-memory blacklist for unit tests or when Redis is disconnected
  private inMemoryBlacklist = new Map<string, number>();

  constructor(config?: TokenServiceConfig) {
    this.jwtSecret = config?.jwtSecret || process.env.JWT_SECRET || 'airline-jwt-secret-key-change-in-production';
    this.expiresIn = config?.expiresIn || process.env.JWT_EXPIRES_IN || '24h';

    const redisUrl = config?.redisUrl || process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          lazyConnect: true,
          retryStrategy: () => null, // Don't crash if Redis is unavailable locally
        });
        this.redis.connect().catch(() => {
          logger.warn('Redis unavailable, using in-memory token revocation cache');
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  /**
   * Generates a signed JWT access token.
   */
  generateToken(payload: { userId: string; email: string; role: UserRole }): string {
    const signOptions: SignOptions = {
      expiresIn: this.expiresIn as any,
    };
    return jwt.sign(payload, this.jwtSecret, signOptions);
  }

  /**
   * Verifies a JWT token and checks the revocation blacklist.
   */
  async verifyToken(token: string): Promise<AuthTokenPayload | null> {
    try {
      // 1. Check if token is blacklisted
      const isRevoked = await this.isTokenRevoked(token);
      if (isRevoked) {
        logger.warn('Token validation failed: Token is revoked/blacklisted');
        return null;
      }

      // 2. Verify signature & expiration
      const decoded = jwt.verify(token, this.jwtSecret) as AuthTokenPayload;
      return decoded;
    } catch (err) {
      logger.debug('Token verification error', { error: (err as Error).message });
      return null;
    }
  }

  /**
   * Adds a token to the Redis revocation list with an expiration TTL.
   */
  async revokeToken(token: string, expiresInSeconds: number = 86400): Promise<void> {
    const blacklistKey = `blacklist:token:${token}`;

    if (this.redis) {
      try {
        await this.redis.set(blacklistKey, 'revoked', 'EX', expiresInSeconds);
        return;
      } catch (err) {
        logger.warn('Failed to blacklist token in Redis, falling back to memory', { error: (err as Error).message });
      }
    }

    // In-memory fallback
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    this.inMemoryBlacklist.set(token, expiresAt);
  }

  /**
   * Checks whether a token has been revoked.
   */
  async isTokenRevoked(token: string): Promise<boolean> {
    const blacklistKey = `blacklist:token:${token}`;

    if (this.redis) {
      try {
        const result = await this.redis.get(blacklistKey);
        return result !== null;
      } catch {
        // Fallback to in-memory check
      }
    }

    const expiry = this.inMemoryBlacklist.get(token);
    if (!expiry) return false;

    if (Date.now() > expiry) {
      this.inMemoryBlacklist.delete(token);
      return false;
    }
    return true;
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {});
      this.redis = null;
    }
  }
}
