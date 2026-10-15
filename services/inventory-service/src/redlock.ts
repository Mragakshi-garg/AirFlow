import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@airline/logger';

const logger = createLogger('redlock-manager');

export interface LockHandle {
  resource: string;
  token: string;
  ttlMs: number;
  acquiredAt: number;
  release(): Promise<boolean>;
}

export interface RedlockConfig {
  redisUrl?: string;
  defaultTtlMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

export class RedlockManager {
  private redis: Redis | null = null;
  private defaultTtlMs: number;
  private inMemoryLocks: Map<string, { token: string; expiresAt: number }> = new Map();

  // Atomic Lua script to safely release Redis lock only if token matches
  private static readonly RELEASE_LUA_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  constructor(config?: RedlockConfig) {
    this.defaultTtlMs = config?.defaultTtlMs || 5000;

    const redisUrl = config?.redisUrl || process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          lazyConnect: true,
          retryStrategy: () => null, // Don't crash if Redis is unavailable locally
        });
        this.redis.connect().catch(() => {
          logger.warn('Redis unavailable, using in-memory distributed lock manager');
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  /**
   * Attempts to acquire a distributed lock for the specified resource.
   * Returns a LockHandle on success, or null if lock is currently held.
   */
  async acquire(resource: string, ttlMs?: number): Promise<LockHandle | null> {
    const ttl = ttlMs || this.defaultTtlMs;
    const token = randomUUID();
    const lockKey = `lock:${resource}`;

    if (this.redis) {
      try {
        const result = await this.redis.set(lockKey, token, 'PX', ttl, 'NX');
        if (result === 'OK') {
          return {
            resource,
            token,
            ttlMs: ttl,
            acquiredAt: Date.now(),
            release: () => this.releaseLock(resource, token),
          };
        }
        return null;
      } catch (err) {
        logger.warn('Redis lock acquisition failed, falling back to in-memory lock', {
          resource,
          error: (err as Error).message,
        });
      }
    }

    // In-memory fallback with atomic check-and-set & expiration
    const now = Date.now();
    const existing = this.inMemoryLocks.get(resource);

    if (existing && existing.expiresAt > now) {
      // Lock is currently held by another holder
      return null;
    }

    // Grant lock
    this.inMemoryLocks.set(resource, { token, expiresAt: now + ttl });
    return {
      resource,
      token,
      ttlMs: ttl,
      acquiredAt: now,
      release: () => this.releaseLock(resource, token),
    };
  }

  /**
   * Safely releases the lock if the token matches.
   */
  async releaseLock(resource: string, token: string): Promise<boolean> {
    const lockKey = `lock:${resource}`;

    if (this.redis) {
      try {
        const result = await this.redis.eval(RedlockManager.RELEASE_LUA_SCRIPT, 1, lockKey, token);
        return result === 1;
      } catch (err) {
        logger.warn('Redis lock release failed, falling back to memory', {
          resource,
          error: (err as Error).message,
        });
      }
    }

    const current = this.inMemoryLocks.get(resource);
    if (!current) {
      return false;
    }

    if (current.token === token) {
      this.inMemoryLocks.delete(resource);
      return true;
    }

    return false;
  }

  /**
   * Check if a resource is currently locked.
   */
  async isLocked(resource: string): Promise<boolean> {
    const lockKey = `lock:${resource}`;

    if (this.redis) {
      try {
        const val = await this.redis.get(lockKey);
        return val !== null;
      } catch {
        // Fallback to in-memory
      }
    }

    const current = this.inMemoryLocks.get(resource);
    if (!current) return false;

    if (Date.now() > current.expiresAt) {
      this.inMemoryLocks.delete(resource);
      return false;
    }
    return true;
  }

  /**
   * Release and disconnect
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {});
      this.redis = null;
    }
    this.inMemoryLocks.clear();
  }
}
