import Redis from 'ioredis';
import { createLogger } from '@airline/logger';

const logger = createLogger('search-cache-service');

export interface CacheConfig {
  redisUrl?: string;
  baseTtlSeconds?: number;
  maxJitterSeconds?: number;
}

export class SearchCacheService {
  private redis: Redis | null = null;
  private baseTtlSeconds: number;
  private maxJitterSeconds: number;

  // Singleflight in-flight request coalescing tracker
  private inFlightGroup: Map<string, Promise<any>> = new Map();

  // In-memory fallback cache
  private inMemoryCache: Map<string, { value: any; expiresAt: number }> = new Map();

  // Metrics tracking for testing and observability
  public metrics = {
    hits: 0,
    misses: 0,
    coalescedRequests: 0,
    totalQueriesExecuted: 0,
  };

  constructor(config?: CacheConfig) {
    this.baseTtlSeconds = config?.baseTtlSeconds || 300; // 5 minutes
    this.maxJitterSeconds = config?.maxJitterSeconds || 60; // 0-60s jitter

    const redisUrl = config?.redisUrl || process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          lazyConnect: true,
          retryStrategy: () => null,
        });
        this.redis.connect().catch(() => {
          logger.warn('Redis unavailable, using in-memory cache with Singleflight');
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  /**
   * Calculates a TTL with randomized jitter to prevent cache stampedes.
   */
  getJitteredTtl(): number {
    const jitter = Math.floor(Math.random() * (this.maxJitterSeconds + 1));
    return this.baseTtlSeconds + jitter;
  }

  /**
   * Deterministic cache key generator for search queries.
   */
  generateCacheKey(prefix: string, params: Record<string, any>): string {
    const sortedKeys = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .sort();

    const normalizedParts = sortedKeys.map((k) => `${k}:${String(params[k]).toLowerCase()}`);
    return `${prefix}:${normalizedParts.join('|') || 'all'}`;
  }

  /**
   * Singleflight Cache-Aside:
   * 1. Check cache (Redis or Memory).
   * 2. On miss, coalesces concurrent callers on an in-flight Promise so only 1 executes computeFn.
   * 3. Sets result in cache with Jittered TTL.
   */
  async getOrSet<T>(key: string, computeFn: () => Promise<T>): Promise<{ data: T; cached: boolean }> {
    // 1. Try Cache
    const cachedData = await this.get<T>(key);
    if (cachedData !== null) {
      this.metrics.hits++;
      return { data: cachedData, cached: true };
    }

    this.metrics.misses++;

    // 2. Singleflight: Check if another request is currently fetching this exact key
    const inFlight = this.inFlightGroup.get(key);
    if (inFlight) {
      this.metrics.coalescedRequests++;
      logger.debug('Singleflight: Coalescing onto in-flight search promise', { key });
      const coalescedData = await inFlight;
      return { data: coalescedData, cached: false };
    }

    // 3. Initiate single query and register promise in singleflight tracker
    const executionPromise = (async () => {
      this.metrics.totalQueriesExecuted++;
      try {
        const result = await computeFn();
        const ttl = this.getJitteredTtl();
        await this.set(key, result, ttl);
        return result;
      } finally {
        this.inFlightGroup.delete(key);
      }
    })();

    this.inFlightGroup.set(key, executionPromise);
    const data = await executionPromise;

    return { data, cached: false };
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redis) {
      try {
        const val = await this.redis.get(key);
        if (val) {
          return JSON.parse(val) as T;
        }
        return null;
      } catch (err) {
        logger.warn('Redis get failed, falling back to in-memory cache', { key, error: (err as Error).message });
      }
    }

    const item = this.inMemoryCache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.inMemoryCache.delete(key);
      return null;
    }

    return item.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds || this.getJitteredTtl();

    if (this.redis) {
      try {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
        return;
      } catch (err) {
        logger.warn('Redis set failed, falling back to in-memory cache', { key, error: (err as Error).message });
      }
    }

    this.inMemoryCache.set(key, {
      value,
      expiresAt: Date.now() + ttl * 1000,
    });
  }

  async invalidate(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch {
        // Fallback
      }
    }
    this.inMemoryCache.delete(key);
  }

  async clearAll(): Promise<void> {
    if (this.redis) {
      try {
        const keys = await this.redis.keys('search:*');
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } catch {
        // Fallback
      }
    }
    this.inMemoryCache.clear();
    this.inFlightGroup.clear();
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {});
      this.redis = null;
    }
    this.inMemoryCache.clear();
    this.inFlightGroup.clear();
  }
}
