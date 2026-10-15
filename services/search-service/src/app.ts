import express, { Express } from 'express';
import { SearchIndex, InMemorySearchIndex } from './search-index';
import { SearchCacheService } from './cache-service';
import { FlightSearchService } from './search-service';
import { SearchController } from './search-controller';

export interface CreateSearchAppOptions {
  searchIndex?: SearchIndex;
  cacheService?: SearchCacheService;
  searchService?: FlightSearchService;
}

export function createSearchApp(options?: CreateSearchAppOptions): {
  app: Express;
  searchIndex: SearchIndex;
  cacheService: SearchCacheService;
  searchService: FlightSearchService;
  controller: SearchController;
} {
  const app = express();
  app.use(express.json());

  const searchIndex = options?.searchIndex || new InMemorySearchIndex();
  const cacheService = options?.cacheService || new SearchCacheService();
  const searchService =
    options?.searchService || new FlightSearchService(searchIndex, cacheService);
  const controller = new SearchController(searchService);

  // Health check
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'search-service' });
  });

  // Search Routes
  app.get('/api/search/flights', controller.searchFlights);
  app.get('/api/search/facets', controller.getFacets);
  app.get('/api/search/flights/:flightId', controller.getFlightById);
  app.post('/api/search/sync', controller.bulkSync);

  return { app, searchIndex, cacheService, searchService, controller };
}
