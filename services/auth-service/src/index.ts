import { createAuthApp } from './app';
import { createLogger } from '@airline/logger';

export * from './token-service';
export * from './rbac';
export * from './auth-controller';
export * from './app';

const logger = createLogger('auth-service');
const PORT = process.env.PORT_AUTH_SERVICE || 4001;

if (require.main === module || process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const { app } = createAuthApp();
  app.listen(PORT, () => {
    logger.info(`Auth Service running on http://localhost:${PORT}`);
  });
}
