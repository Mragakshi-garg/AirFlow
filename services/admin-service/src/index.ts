import { createAdminApp } from './app';
import { createLogger } from '@airline/logger';

export * from './admin-controller';
export * from './app';

const logger = createLogger('admin-service');
const PORT = process.env.PORT_ADMIN_SERVICE || 4002;

if (require.main === module || process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const { app } = createAdminApp();
  app.listen(PORT, () => {
    logger.info(`Admin Service running on http://localhost:${PORT}`);
  });
}
