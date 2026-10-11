import { Pool, PoolConfig } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export interface DatabaseConfig {
  connectionString?: string;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class DatabaseClient {
  private pool: Pool;
  public db: NodePgDatabase<typeof schema>;

  constructor(config?: DatabaseConfig) {
    const connectionString = config?.connectionString || 
      process.env.DATABASE_URL || 
      'postgresql://airline_user:airline_secret@localhost:5432/airline_db';

    const poolConfig: PoolConfig = {
      connectionString,
      max: config?.maxConnections || 20,
      idleTimeoutMillis: config?.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config?.connectionTimeoutMillis || 5000,
    };

    this.pool = new Pool(poolConfig);
    this.db = drizzle(this.pool, { schema });

    this.pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL client error in pool:', err);
    });
  }

  getPool(): Pool {
    return this.pool;
  }

  async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      client.release();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Default singleton helper
let defaultClient: DatabaseClient | null = null;

export function getDatabaseClient(config?: DatabaseConfig): DatabaseClient {
  if (!defaultClient) {
    defaultClient = new DatabaseClient(config);
  }
  return defaultClient;
}

export function createDatabaseClient(config?: DatabaseConfig): DatabaseClient {
  return new DatabaseClient(config);
}
